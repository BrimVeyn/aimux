/**
 * Continuous status detection loop.
 *
 * Backends drive this loop to monitor every known terminal at a fixed cadence:
 * every tick we pull each tab's current viewport, run the detector on the last
 * ~10 non-blank lines, and report per-tab + per-project statuses to the
 * backend's transport. The loop is the single source of truth so that idle
 * tabs can't erase a sibling's waiting-input, and so that clients receive
 * status for every project the backend owns, not just the attached one.
 *
 * Per-project status is a pair of independent booleans:
 *   - `working`: at least one tab is working.
 *   - `waiting`: at least one tab is waiting for user input.
 * Both can be true at the same time — the chip renders one glyph per flag.
 */
import type { AssistantId, ProjectStatus, TabActivity, TerminalSnapshot } from '../state/types'

import { logDebug } from '../debug/input-log'
import { getLineText } from '../input/terminal-text-extraction'
import { extractQuestion } from './assistant-question-extractor'
import { AssistantStatusArbiter, type RecordHookEventInput } from './assistant-status-arbiter'
import { AssistantStatusDetector } from './assistant-status-detector'

function tailPreview(viewport: TerminalSnapshot | undefined): string {
  if (!viewport) return '<no-viewport>'
  const lines = viewport.lines
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line) continue
    const text = getLineText(line).trim()
    if (text.length > 0) return text.slice(0, 80)
  }
  return '<blank>'
}

/** Default polling interval. Cheap — detector is a handful of substring checks. */
const DEFAULT_TICK_MS = 500

/**
 * How long a tab's `idle` activity must hold continuously before we call the
 * turn complete. `idle` can flash for a fraction of a second between two tool
 * calls, so an end-of-turn signal that fired on the first idle tick would catch
 * the worker mid-turn. Requiring idle to *hold* this long is the authoritative
 * replacement for a driver's settle-poll loop.
 */
const DEFAULT_TURN_SETTLE_MS = 1500

export interface LoopTabView {
  id: string
  assistant: AssistantId
  command: string
  viewport?: TerminalSnapshot
  /** The workspace this tab belongs to, when its owner knows one. Passed
   *  straight through to the status callbacks so a client can group tabs it
   *  does not itself hold — see the `workspaceId` note in `src/ipc/protocol.ts`. */
  workspaceId?: string
}

export interface StatusDetectionLoopOptions {
  listProjects: () => string[]
  listTabs: (projectId: string) => LoopTabView[]
  /** Emitted when a tab's status changes. */
  onTabStatus: (
    tabId: string,
    status: TabActivity,
    projectId: string,
    workspaceId: string | undefined
  ) => void
  /** Emitted when either flag on a project changes. */
  onProjectStatus: (projectId: string, status: ProjectStatus) => void
  /**
   * Emitted once per turn, when a tab's `idle` activity has held continuously
   * for `turnSettleMs`. Edge-triggered: re-armed only after the tab leaves
   * `idle`, so a driver receives exactly one signal per turn. `idleMs` is how
   * long idle had held when the signal fired.
   */
  onTurnComplete?: (
    tabId: string,
    projectId: string,
    idleMs: number,
    workspaceId: string | undefined
  ) => void
  /**
   * Emitted when a tab transitions into `waiting-input`. Edge-triggered: fires
   * once per transition, carrying the captured prompt text and any parsed
   * options. Fires on both tick and attach replay so a client that attaches to
   * an already-blocked tab still learns the question.
   */
  onTabQuestion?: (
    tabId: string,
    projectId: string,
    detail: { kind: 'question' | 'permission'; prompt: string; options?: string[] }
  ) => void
  tickMs?: number
  /** Override the turn-complete settle window (default 1500ms). */
  turnSettleMs?: number
  /** Override the clock. Defaults to Date.now. Tests inject a logical clock so
   *  the wall-clock-driven turn-complete settle is deterministic. */
  nowFn?: () => number
}

export interface StatusDetectionLoopHandle {
  stop: () => void
  /** Last classified status for a tab, for on-attach replay. */
  getTabStatus: (tabId: string) => TabActivity | undefined
  /** Last project flags, for on-attach replay. */
  getProjectStatus: (projectId: string) => ProjectStatus | undefined
  /** Snapshot of every known project's flags. */
  snapshotProjects: () => { projectId: string; status: ProjectStatus }[]
  /** Snapshot of every known tab's status plus its project. */
  snapshotTabs: () => { tabId: string; projectId: string; status: TabActivity }[]
  /**
   * Synchronously run classification for a single project. Used on client
   * attach so the replay snapshot is populated *before* the client reads it,
   * rather than relying on the next scheduled tick.
   */
  classifyNow: (projectId: string, tabs: LoopTabView[]) => void
  /**
   * Feed a Claude Code hook event into the arbiter. The next tick will
   * combine it with the visual detector's verdict. Called by the daemon's
   * hook HTTP server.
   */
  recordHookEvent: (input: RecordHookEventInput) => void
}

export function runStatusDetectionLoop(
  options: StatusDetectionLoopOptions
): StatusDetectionLoopHandle {
  const tickMs = options.tickMs ?? DEFAULT_TICK_MS
  const turnSettleMs = options.turnSettleMs ?? DEFAULT_TURN_SETTLE_MS
  const now = options.nowFn ?? Date.now
  const detector = new AssistantStatusDetector()
  const arbiter = new AssistantStatusArbiter()
  const lastTabStatus = new Map<
    string,
    { status: TabActivity; projectId: string; workspaceId?: string }
  >()
  const lastProjectStatus = new Map<string, ProjectStatus>()
  // Timestamp when a tab most recently entered `idle`. Cleared when it leaves
  // idle. `turnEmitted` guards against re-firing `onTurnComplete` within the
  // same idle episode; it's cleared alongside `idleSince` so the next turn
  // re-arms.
  const idleSince = new Map<string, number>()
  const turnEmitted = new Set<string>()

  const timer = setInterval(() => {
    try {
      tick()
    } catch (error) {
      logDebug('statusLoop.tickError', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }, tickMs)
  timer.unref?.()

  function classifySession(
    projectId: string,
    tabs: LoopTabView[],
    now: number,
    source: 'tick' | 'classifyNow',
    seenTabs?: Set<string>
  ): void {
    let working = false
    let waiting = false
    for (const tab of tabs) {
      seenTabs?.add(tab.id)
      const visual = detector.classify({
        assistant: tab.assistant,
        command: tab.command,
        now,
        tabId: tab.id,
        viewport: tab.viewport,
      })
      const status = arbiter.arbitrate(tab.id, visual, now)
      if (status === 'working') working = true
      if (status === 'waiting-input') waiting = true
      const prev = lastTabStatus.get(tab.id)
      const changed = !prev || prev.status !== status || prev.projectId !== projectId
      logDebug('statusLoop.classify', {
        assistant: tab.assistant,
        changed,
        prevProjectId: prev?.projectId,
        prevStatus: prev?.status,
        projectId,
        source,
        status,
        tabId: tab.id,
        tailPreview: tailPreview(tab.viewport),
      })
      if (changed) {
        lastTabStatus.set(tab.id, { projectId, status, workspaceId: tab.workspaceId })
        options.onTabStatus(tab.id, status, projectId, tab.workspaceId)
      }

      // Turn-complete bookkeeping. The emission itself is gated to `tick` so a
      // synchronous attach replay (`classifyNow`) never fabricates an
      // end-of-turn — only the wall-clock-driven poll does. The idleSince /
      // turnEmitted maps are maintained on every call so state stays coherent
      // regardless of source.
      if (status === 'idle') {
        let since = idleSince.get(tab.id)
        if (since === undefined) {
          since = now
          idleSince.set(tab.id, since)
        }
        if (source === 'tick' && !turnEmitted.has(tab.id) && now - since >= turnSettleMs) {
          turnEmitted.add(tab.id)
          options.onTurnComplete?.(tab.id, projectId, now - since, tab.workspaceId)
        }
      } else {
        idleSince.delete(tab.id)
        turnEmitted.delete(tab.id)
      }

      // Question extraction on the idle/working → waiting-input edge. `prev`
      // still holds the pre-update status, so this fires exactly once per
      // transition even though the loop broadcasts to every client.
      if (
        status === 'waiting-input' &&
        (!prev || prev.status !== 'waiting-input') &&
        options.onTabQuestion
      ) {
        const detail = extractQuestion(tab.assistant, tab.viewport)
        if (detail) options.onTabQuestion(tab.id, projectId, detail)
      }
    }
    const next: ProjectStatus = { waiting, working }
    const prevProject = lastProjectStatus.get(projectId)
    const projectChanged =
      !prevProject || prevProject.working !== working || prevProject.waiting !== waiting
    logDebug('statusLoop.classifySession', {
      prev: prevProject,
      projectChanged,
      projectId,
      source,
      status: next,
      tabCount: tabs.length,
    })
    if (projectChanged) {
      lastProjectStatus.set(projectId, next)
      options.onProjectStatus(projectId, next)
    }
  }

  function tick(): void {
    const ts = now()
    const projectIds = options.listProjects()
    const seenProjects = new Set<string>()
    const seenTabs = new Set<string>()

    for (const projectId of projectIds) {
      seenProjects.add(projectId)
      classifySession(projectId, options.listTabs(projectId), ts, 'tick', seenTabs)
    }

    for (const [tabId, entry] of lastTabStatus) {
      if (!seenTabs.has(tabId)) {
        detector.forget(tabId)
        arbiter.forget(tabId)
        lastTabStatus.delete(tabId)
        idleSince.delete(tabId)
        turnEmitted.delete(tabId)
        // A gone tab is no longer working or waiting on anyone. Only clients
        // attached to its project hear its `tabExit`, so without this last
        // word a tab that died mid-turn leaves every other client holding a
        // status that will never be corrected.
        if (entry.status !== 'idle') {
          options.onTabStatus(tabId, 'idle', entry.projectId, entry.workspaceId)
        }
      }
    }
    for (const projectId of lastProjectStatus.keys()) {
      if (!seenProjects.has(projectId)) {
        lastProjectStatus.delete(projectId)
      }
    }
  }

  return {
    classifyNow: (projectId, tabs) => {
      classifySession(projectId, tabs, now(), 'classifyNow')
    },
    getProjectStatus: (projectId) => lastProjectStatus.get(projectId),
    getTabStatus: (tabId) => lastTabStatus.get(tabId)?.status,
    recordHookEvent: (input) => {
      const mapped = arbiter.recordHookEvent(input)
      logDebug('statusLoop.recordHookEvent', {
        hookEventName: input.hookEventName,
        mapped,
        paneId: input.paneId,
      })
    },
    snapshotProjects: () =>
      [...lastProjectStatus.entries()].map(([projectId, status]) => ({ projectId, status })),
    snapshotTabs: () =>
      [...lastTabStatus.entries()].map(([tabId, entry]) => ({
        projectId: entry.projectId,
        status: entry.status,
        tabId,
      })),
    stop: () => {
      clearInterval(timer)
      detector.clear()
      arbiter.clear()
      lastTabStatus.clear()
      lastProjectStatus.clear()
      idleSince.clear()
      turnEmitted.clear()
    },
  }
}

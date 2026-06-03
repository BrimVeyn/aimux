/**
 * Continuous status detection loop.
 *
 * Backends drive this loop to monitor every known terminal at a fixed cadence:
 * every tick we pull each tab's current viewport, run the detector on the last
 * ~10 non-blank lines, and report per-tab + per-session statuses to the
 * backend's transport. The loop is the single source of truth so that idle
 * tabs can't erase a sibling's waiting-input, and so that clients receive
 * status for every session the backend owns, not just the attached one.
 *
 * Per-session status is a pair of independent booleans:
 *   - `working`: at least one tab is working.
 *   - `waiting`: at least one tab is waiting for user input.
 * Both can be true at the same time — the chip renders one glyph per flag.
 */
import type { AssistantId, SessionStatus, TabActivity, TerminalSnapshot } from '../state/types'

import { logDebug } from '../debug/input-log'
import { getLineText } from '../input/terminal-text-extraction'
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

export interface LoopTabView {
  id: string
  assistant: AssistantId
  command: string
  viewport?: TerminalSnapshot
  worktreeId?: string
}

/**
 * Sentinel worktree id for tabs without a `worktreeId`. The frontend merges
 * this bucket into the primary worktree's status — keeps legacy/pre-worktree
 * tabs from disappearing from the sidebar indicator.
 */
export const UNASSIGNED_WORKTREE_ID = ''

export interface StatusDetectionLoopOptions {
  listSessions: () => string[]
  listTabs: (sessionId: string) => LoopTabView[]
  /** Emitted when a tab's status changes. */
  onTabStatus: (tabId: string, status: TabActivity, sessionId: string) => void
  /** Emitted when either flag on a session changes. */
  onSessionStatus: (sessionId: string, status: SessionStatus) => void
  /**
   * Emitted when either flag on a worktree changes. The `worktreeId` is the
   * tab's `worktreeId`, or `UNASSIGNED_WORKTREE_ID` for tabs without one.
   */
  onWorktreeStatus: (worktreeId: string, status: SessionStatus, sessionId: string) => void
  tickMs?: number
}

export interface StatusDetectionLoopHandle {
  stop: () => void
  /** Last classified status for a tab, for on-attach replay. */
  getTabStatus: (tabId: string) => TabActivity | undefined
  /** Last session flags, for on-attach replay. */
  getSessionStatus: (sessionId: string) => SessionStatus | undefined
  /** Last worktree flags, for on-attach replay. */
  getWorktreeStatus: (worktreeId: string) => SessionStatus | undefined
  /** Snapshot of every known session's flags. */
  snapshotSessions: () => { sessionId: string; status: SessionStatus }[]
  /** Snapshot of every known worktree's flags. */
  snapshotWorktrees: () => { worktreeId: string; sessionId: string; status: SessionStatus }[]
  /** Snapshot of every known tab's status plus its session. */
  snapshotTabs: () => { tabId: string; sessionId: string; status: TabActivity }[]
  /**
   * Synchronously run classification for a single session. Used on client
   * attach so the replay snapshot is populated *before* the client reads it,
   * rather than relying on the next scheduled tick.
   */
  classifyNow: (sessionId: string, tabs: LoopTabView[]) => void
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
  const detector = new AssistantStatusDetector()
  const arbiter = new AssistantStatusArbiter()
  const lastTabStatus = new Map<string, { status: TabActivity; sessionId: string }>()
  const lastSessionStatus = new Map<string, SessionStatus>()
  const lastWorktreeStatus = new Map<string, { status: SessionStatus; sessionId: string }>()

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
    sessionId: string,
    tabs: LoopTabView[],
    now: number,
    source: 'tick' | 'classifyNow',
    seenTabs?: Set<string>,
    seenWorktrees?: Set<string>
  ): void {
    let working = false
    let waiting = false
    // Worktrees this session contributes to this tick — used to clear any
    // worktree bucket that no longer has matching tabs (e.g. last tab moved
    // to another worktree). We seed every observed bucket with idle so it
    // gets emitted as `{working: false, waiting: false}` rather than vanishing.
    const worktreeAgg = new Map<string, SessionStatus>()
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
      const worktreeKey = tab.worktreeId ?? UNASSIGNED_WORKTREE_ID
      const prevAgg = worktreeAgg.get(worktreeKey) ?? { waiting: false, working: false }
      worktreeAgg.set(worktreeKey, {
        waiting: prevAgg.waiting || status === 'waiting-input',
        working: prevAgg.working || status === 'working',
      })
      const prev = lastTabStatus.get(tab.id)
      const changed = !prev || prev.status !== status || prev.sessionId !== sessionId
      logDebug('statusLoop.classify', {
        assistant: tab.assistant,
        changed,
        prevSessionId: prev?.sessionId,
        prevStatus: prev?.status,
        sessionId,
        source,
        status,
        tabId: tab.id,
        tailPreview: tailPreview(tab.viewport),
      })
      if (changed) {
        lastTabStatus.set(tab.id, { sessionId, status })
        options.onTabStatus(tab.id, status, sessionId)
      }
    }
    const next: SessionStatus = { waiting, working }
    const prevSession = lastSessionStatus.get(sessionId)
    const sessionChanged =
      !prevSession || prevSession.working !== working || prevSession.waiting !== waiting
    logDebug('statusLoop.classifySession', {
      prev: prevSession,
      sessionChanged,
      sessionId,
      source,
      status: next,
      tabCount: tabs.length,
    })
    if (sessionChanged) {
      lastSessionStatus.set(sessionId, next)
      options.onSessionStatus(sessionId, next)
    }
    for (const [worktreeId, status] of worktreeAgg) {
      seenWorktrees?.add(worktreeId)
      const prevWt = lastWorktreeStatus.get(worktreeId)
      const wtChanged =
        !prevWt ||
        prevWt.sessionId !== sessionId ||
        prevWt.status.working !== status.working ||
        prevWt.status.waiting !== status.waiting
      if (wtChanged) {
        lastWorktreeStatus.set(worktreeId, { sessionId, status })
        options.onWorktreeStatus(worktreeId, status, sessionId)
      }
    }
  }

  function tick(): void {
    const now = Date.now()
    const sessionIds = options.listSessions()
    const seenSessions = new Set<string>()
    const seenTabs = new Set<string>()
    const seenWorktrees = new Set<string>()

    for (const sessionId of sessionIds) {
      seenSessions.add(sessionId)
      classifySession(sessionId, options.listTabs(sessionId), now, 'tick', seenTabs, seenWorktrees)
    }

    for (const tabId of lastTabStatus.keys()) {
      if (!seenTabs.has(tabId)) {
        detector.forget(tabId)
        arbiter.forget(tabId)
        lastTabStatus.delete(tabId)
      }
    }
    for (const sessionId of lastSessionStatus.keys()) {
      if (!seenSessions.has(sessionId)) {
        lastSessionStatus.delete(sessionId)
      }
    }
    for (const [worktreeId, entry] of lastWorktreeStatus) {
      if (!seenWorktrees.has(worktreeId)) {
        // Worktree no longer has any tabs — clear it to idle so the UI drops
        // any stale spinner/waiting glyph, then remove from the map.
        if (entry.status.working || entry.status.waiting) {
          options.onWorktreeStatus(worktreeId, { waiting: false, working: false }, entry.sessionId)
        }
        lastWorktreeStatus.delete(worktreeId)
      }
    }
  }

  return {
    classifyNow: (sessionId, tabs) => {
      classifySession(sessionId, tabs, Date.now(), 'classifyNow')
    },
    getSessionStatus: (sessionId) => lastSessionStatus.get(sessionId),
    getTabStatus: (tabId) => lastTabStatus.get(tabId)?.status,
    getWorktreeStatus: (worktreeId) => lastWorktreeStatus.get(worktreeId)?.status,
    recordHookEvent: (input) => {
      const mapped = arbiter.recordHookEvent(input)
      logDebug('statusLoop.recordHookEvent', {
        hookEventName: input.hookEventName,
        mapped,
        paneId: input.paneId,
      })
    },
    snapshotSessions: () =>
      [...lastSessionStatus.entries()].map(([sessionId, status]) => ({ sessionId, status })),
    snapshotTabs: () =>
      [...lastTabStatus.entries()].map(([tabId, entry]) => ({
        sessionId: entry.sessionId,
        status: entry.status,
        tabId,
      })),
    snapshotWorktrees: () =>
      [...lastWorktreeStatus.entries()].map(([worktreeId, entry]) => ({
        sessionId: entry.sessionId,
        status: entry.status,
        worktreeId,
      })),
    stop: () => {
      clearInterval(timer)
      detector.clear()
      arbiter.clear()
      lastTabStatus.clear()
      lastSessionStatus.clear()
      lastWorktreeStatus.clear()
    },
  }
}

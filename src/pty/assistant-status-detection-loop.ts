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
import { AssistantStatusDetector } from './assistant-status-detector'

/** Default polling interval. Cheap — detector is a handful of substring checks. */
const DEFAULT_TICK_MS = 500

export interface LoopTabView {
  id: string
  assistant: AssistantId
  command: string
  viewport?: TerminalSnapshot
}

export interface StatusDetectionLoopOptions {
  listSessions: () => string[]
  listTabs: (sessionId: string) => LoopTabView[]
  /** Emitted when a tab's status changes. */
  onTabStatus: (tabId: string, status: TabActivity, sessionId: string) => void
  /** Emitted when either flag on a session changes. */
  onSessionStatus: (sessionId: string, status: SessionStatus) => void
  tickMs?: number
}

export interface StatusDetectionLoopHandle {
  stop: () => void
  /** Last classified status for a tab, for on-attach replay. */
  getTabStatus: (tabId: string) => TabActivity | undefined
  /** Last session flags, for on-attach replay. */
  getSessionStatus: (sessionId: string) => SessionStatus | undefined
  /** Snapshot of every known session's flags. */
  snapshotSessions: () => Array<{ sessionId: string; status: SessionStatus }>
  /** Snapshot of every known tab's status plus its session. */
  snapshotTabs: () => Array<{ tabId: string; sessionId: string; status: TabActivity }>
  /**
   * Synchronously run classification for a single session. Used on client
   * attach so the replay snapshot is populated *before* the client reads it,
   * rather than relying on the next scheduled tick.
   */
  classifyNow: (sessionId: string, tabs: LoopTabView[]) => void
}

export function runStatusDetectionLoop(
  options: StatusDetectionLoopOptions
): StatusDetectionLoopHandle {
  const tickMs = options.tickMs ?? DEFAULT_TICK_MS
  const detector = new AssistantStatusDetector()
  const lastTabStatus = new Map<string, { status: TabActivity; sessionId: string }>()
  const lastSessionStatus = new Map<string, SessionStatus>()

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
    seenTabs?: Set<string>
  ): void {
    let working = false
    let waiting = false
    for (const tab of tabs) {
      seenTabs?.add(tab.id)
      const status = detector.classify({
        assistant: tab.assistant,
        command: tab.command,
        now,
        tabId: tab.id,
        viewport: tab.viewport,
      })
      if (status === 'working') working = true
      if (status === 'waiting-input') waiting = true
      const prev = lastTabStatus.get(tab.id)
      if (!prev || prev.status !== status || prev.sessionId !== sessionId) {
        lastTabStatus.set(tab.id, { sessionId, status })
        options.onTabStatus(tab.id, status, sessionId)
      }
    }
    const next: SessionStatus = { waiting, working }
    const prevSession = lastSessionStatus.get(sessionId)
    if (!prevSession || prevSession.working !== working || prevSession.waiting !== waiting) {
      lastSessionStatus.set(sessionId, next)
      options.onSessionStatus(sessionId, next)
    }
  }

  function tick(): void {
    const now = Date.now()
    const sessionIds = options.listSessions()
    const seenSessions = new Set<string>()
    const seenTabs = new Set<string>()

    for (const sessionId of sessionIds) {
      seenSessions.add(sessionId)
      classifySession(sessionId, options.listTabs(sessionId), now, seenTabs)
    }

    for (const tabId of lastTabStatus.keys()) {
      if (!seenTabs.has(tabId)) {
        detector.forget(tabId)
        lastTabStatus.delete(tabId)
      }
    }
    for (const sessionId of lastSessionStatus.keys()) {
      if (!seenSessions.has(sessionId)) {
        lastSessionStatus.delete(sessionId)
      }
    }
  }

  return {
    classifyNow: (sessionId, tabs) => {
      classifySession(sessionId, tabs, Date.now())
    },
    getSessionStatus: (sessionId) => lastSessionStatus.get(sessionId),
    getTabStatus: (tabId) => lastTabStatus.get(tabId)?.status,
    snapshotSessions: () =>
      [...lastSessionStatus.entries()].map(([sessionId, status]) => ({ sessionId, status })),
    snapshotTabs: () =>
      [...lastTabStatus.entries()].map(([tabId, entry]) => ({
        sessionId: entry.sessionId,
        status: entry.status,
        tabId,
      })),
    stop: () => {
      clearInterval(timer)
      detector.clear()
      lastTabStatus.clear()
      lastSessionStatus.clear()
    },
  }
}

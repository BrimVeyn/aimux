/**
 * Continuous status detection loop.
 *
 * Backends drive this loop to monitor every known terminal at a fixed cadence:
 * every tick we pull each tab's current viewport, run the detector on the last
 * ~10 non-blank lines, and report per-tab + aggregated per-session statuses to
 * the backend's transport. The loop is the single source of truth so that
 * idle tabs can't erase a sibling's waiting-input (aggregation is max-priority
 * `working` > `waiting-input` > `idle`), and so that clients receive status
 * for every session the backend owns, not just the attached one.
 */
import type { AssistantId, TabActivity, TerminalSnapshot } from '../state/types'

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
  /** Emitted when a session's aggregate status changes. */
  onSessionStatus: (sessionId: string, status: TabActivity) => void
  tickMs?: number
}

export function runStatusDetectionLoop(options: StatusDetectionLoopOptions): () => void {
  const tickMs = options.tickMs ?? DEFAULT_TICK_MS
  const detector = new AssistantStatusDetector()
  const lastTabStatus = new Map<string, TabActivity>()
  const lastSessionStatus = new Map<string, TabActivity>()
  const knownTabs = new Set<string>()
  const knownSessions = new Set<string>()

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

  function tick(): void {
    const now = Date.now()
    const sessionIds = options.listSessions()
    const seenSessions = new Set<string>()
    const seenTabs = new Set<string>()

    for (const sessionId of sessionIds) {
      seenSessions.add(sessionId)
      const tabs = options.listTabs(sessionId)
      let aggregate: TabActivity = 'idle'
      for (const tab of tabs) {
        seenTabs.add(tab.id)
        const status = detector.classify({
          assistant: tab.assistant,
          command: tab.command,
          now,
          tabId: tab.id,
          viewport: tab.viewport,
        })
        if (status === 'working') {
          aggregate = 'working'
        } else if (status === 'waiting-input' && aggregate !== 'working') {
          aggregate = 'waiting-input'
        }
        const prev = lastTabStatus.get(tab.id)
        if (prev !== status) {
          lastTabStatus.set(tab.id, status)
          knownTabs.add(tab.id)
          options.onTabStatus(tab.id, status, sessionId)
        }
      }
      const prevSession = lastSessionStatus.get(sessionId)
      if (prevSession !== aggregate) {
        lastSessionStatus.set(sessionId, aggregate)
        knownSessions.add(sessionId)
        options.onSessionStatus(sessionId, aggregate)
      }
    }

    // Forget tabs that vanished so stale entries don't hold the aggregate hostage.
    for (const tabId of knownTabs) {
      if (!seenTabs.has(tabId)) {
        detector.forget(tabId)
        lastTabStatus.delete(tabId)
        knownTabs.delete(tabId)
      }
    }
    for (const sessionId of knownSessions) {
      if (!seenSessions.has(sessionId)) {
        lastSessionStatus.delete(sessionId)
        knownSessions.delete(sessionId)
      }
    }
  }

  return () => {
    clearInterval(timer)
    detector.clear()
    lastTabStatus.clear()
    lastSessionStatus.clear()
    knownTabs.clear()
    knownSessions.clear()
  }
}

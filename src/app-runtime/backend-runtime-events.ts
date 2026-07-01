import type { MutableRefObject } from 'react'

import type { SessionBackend } from '../session-backend/types'
import type {
  AppAction,
  SessionStatus,
  TabActivity,
  TabSession,
  TerminalModeState,
} from '../state/types'
import type { TabRuntimeTimeouts } from './tab-runtime-timeouts'

import { logInputDebug } from '../debug/input-log'
import { clearTabSyntaxState, highlightSnapshot } from '../integrations/claude-syntax-overlay'
import { appStore } from '../state/app-store'

interface BindBackendRuntimeEventsOptions {
  backend: SessionBackend
  dispatch: (action: AppAction) => void
  resizingRef: MutableRefObject<boolean>
  timeouts: Pick<TabRuntimeTimeouts, 'clearIdleTimer' | 'clearStartupGrace' | 'clearAllTimers'>
  syntaxOverlayEnabled: () => boolean
}

function clearTabRuntimeState(
  timeouts: Pick<TabRuntimeTimeouts, 'clearIdleTimer' | 'clearStartupGrace'>,
  tabId: string
): void {
  timeouts.clearIdleTimer(tabId)
  timeouts.clearStartupGrace(tabId)
}

export function bindBackendRuntimeEvents({
  backend,
  dispatch,
  resizingRef,
  syntaxOverlayEnabled,
  timeouts,
}: BindBackendRuntimeEventsOptions): () => void {
  const handleRender = (
    tabId: string,
    viewport: TabSession['viewport'],
    terminalModes: TerminalModeState
  ) => {
    if (!viewport) {
      return
    }

    logInputDebug('app.backend.event.render', {
      lines: viewport.lines.length,
      tabId,
      viewportY: viewport.viewportY,
    })

    const transformed = syntaxOverlayEnabled() ? highlightSnapshot(viewport, tabId) : viewport

    dispatch({
      source: resizingRef.current ? 'resize' : 'data',
      tabId,
      terminalModes,
      type: 'replace-tab-viewport',
      viewport: transformed,
    })
    // Per-tab activity is driven by the backend's status-detection loop via
    // the `tabActivity` event — no client-side idle timer needed.
  }

  const handleExit = (tabId: string, exitCode: number) => {
    logInputDebug('app.backend.event.exit', { exitCode, tabId })
    clearTabRuntimeState(timeouts, tabId)
    clearTabSyntaxState(tabId)
    dispatch({ tabId, type: 'close-tab' })
  }

  const handleError = (tabId: string, message: string) => {
    logInputDebug('app.backend.event.error', { message, tabId })
    clearTabRuntimeState(timeouts, tabId)
    clearTabSyntaxState(tabId)
    dispatch({ message, tabId, type: 'set-tab-error' })
  }

  const handleSessionActivity = (sessionId: string, status: SessionStatus) => {
    logInputDebug('app.backend.event.sessionActivity', { sessionId, status })
    dispatch({ sessionId, status, type: 'set-session-status' })
  }

  const handleTabActivity = (tabId: string, activity: TabActivity) => {
    logInputDebug('app.backend.event.tabActivity', { activity, tabId })
    dispatch({ activity, tabId, type: 'set-tab-activity' })
  }

  const handleTabAdded = (sessionId: string, tab: TabSession) => {
    // Idempotent: the daemon broadcasts `tabAdded` for every createTab,
    // including the ones this UI process initiated (which already dispatched
    // `add-tab` locally). Skip the duplicate so we don't get two entries for
    // the same tab id.
    const current = appStore.getState()
    if (current.tabs.some((t) => t.id === tab.id)) {
      logInputDebug('app.backend.event.tabAdded.skipDuplicate', { sessionId, tabId: tab.id })
      return
    }
    if (current.currentSessionId !== sessionId) {
      logInputDebug('app.backend.event.tabAdded.skipForeignSession', {
        currentSessionId: current.currentSessionId,
        sessionId,
        tabId: tab.id,
      })
      return
    }
    logInputDebug('app.backend.event.tabAdded', { sessionId, tabId: tab.id })
    dispatch({ tab, type: 'add-tab' })
  }

  backend.on('render', handleRender)
  backend.on('exit', handleExit)
  backend.on('error', handleError)
  backend.on('sessionActivity', handleSessionActivity)
  backend.on('tabActivity', handleTabActivity)
  backend.on('tabAdded', handleTabAdded)

  return () => {
    timeouts.clearAllTimers()
    backend.off('render', handleRender)
    backend.off('exit', handleExit)
    backend.off('error', handleError)
    backend.off('sessionActivity', handleSessionActivity)
    backend.off('tabActivity', handleTabActivity)
    backend.off('tabAdded', handleTabAdded)
    void backend.destroy(true)
  }
}

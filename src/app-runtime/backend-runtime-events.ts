import type { MutableRefObject } from 'react'

import type { SessionBackend } from '../session-backend/types'
import type {
  AppAction,
  SessionStatus,
  TabActivity,
  TabSession,
  TerminalModeState,
} from '../state/types'

import { logInputDebug } from '../debug/input-log'
import { type TabRuntimeTimeouts } from './tab-runtime-timeouts'

interface BindBackendRuntimeEventsOptions {
  backend: SessionBackend
  dispatch: (action: AppAction) => void
  resizingRef: MutableRefObject<boolean>
  timeouts: Pick<TabRuntimeTimeouts, 'clearIdleTimer' | 'clearStartupGrace' | 'clearAllTimers'>
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

    dispatch({
      source: resizingRef.current ? 'resize' : 'data',
      tabId,
      terminalModes,
      type: 'replace-tab-viewport',
      viewport,
    })
    // Per-tab activity is driven by the backend's status-detection loop via
    // the `tabActivity` event — no client-side idle timer needed.
  }

  const handleExit = (tabId: string, exitCode: number) => {
    logInputDebug('app.backend.event.exit', { exitCode, tabId })
    clearTabRuntimeState(timeouts, tabId)
    dispatch({ tabId, type: 'close-tab' })
  }

  const handleError = (tabId: string, message: string) => {
    logInputDebug('app.backend.event.error', { message, tabId })
    clearTabRuntimeState(timeouts, tabId)
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

  backend.on('render', handleRender)
  backend.on('exit', handleExit)
  backend.on('error', handleError)
  backend.on('sessionActivity', handleSessionActivity)
  backend.on('tabActivity', handleTabActivity)

  return () => {
    timeouts.clearAllTimers()
    backend.off('render', handleRender)
    backend.off('exit', handleExit)
    backend.off('error', handleError)
    backend.off('sessionActivity', handleSessionActivity)
    backend.off('tabActivity', handleTabActivity)
    void backend.destroy(true)
  }
}

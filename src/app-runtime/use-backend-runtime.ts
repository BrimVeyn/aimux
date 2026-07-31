import { type MutableRefObject, useEffect, useRef } from 'react'

import type { SessionBackend } from '../session-backend/types'
import type { AppAction, LayoutState } from '../state/types'

import { attachCurrentSession } from './backend-attach-runtime'
import { bindBackendRuntimeEvents } from './backend-runtime-events'
import { useTabRuntimeTimeouts } from './tab-runtime-timeouts'

interface BackendRuntimeOptions {
  backend: SessionBackend
  dispatch: (action: AppAction) => void
  activeTabId: string | null
  currentProjectId: string | null
  layoutRef: MutableRefObject<LayoutState>
  resizingRef: MutableRefObject<boolean>
  currentProjectProjectSnapshot: Parameters<SessionBackend['attach']>[0]['projectSnapshot']
  syntaxOverlayEnabled: () => boolean
}

export interface TabRuntimeControls {
  clearIdleTimer: (tabId: string) => void
  clearStartupGrace: (tabId: string) => void
  startStartupGrace: (tabId: string, timeoutMs: number) => void
}

export function useBackendRuntime({
  activeTabId,
  backend,
  currentProjectId,
  currentProjectProjectSnapshot,
  dispatch,
  layoutRef,
  resizingRef,
  syntaxOverlayEnabled,
}: BackendRuntimeOptions): TabRuntimeControls {
  const attachRequestIdRef = useRef(0)
  const timeouts = useTabRuntimeTimeouts(dispatch)
  const { clearAllTimers, clearIdleTimer, clearStartupGrace, startStartupGrace } = timeouts

  useEffect(() => {
    if (!(currentProjectId != null && currentProjectId !== '')) {
      attachRequestIdRef.current += 1
      return
    }

    return attachCurrentSession({
      attachRequestIdRef,
      backend,
      currentProjectId,
      currentProjectProjectSnapshot,
      dispatch,
      layoutRef,
    })
  }, [backend, currentProjectId, currentProjectProjectSnapshot, dispatch, layoutRef])

  useEffect(() => {
    if (!(currentProjectId != null && currentProjectId !== '')) {
      return
    }

    // The backend owns each tab's scroll position; a backgrounded tab keeps it
    // in its own emulator, so switching back needs no re-anchor from here.
    backend.setActiveTab(activeTabId)
  }, [activeTabId, backend, currentProjectId])

  useEffect(() => {
    return bindBackendRuntimeEvents({
      backend,
      dispatch,
      resizingRef,
      syntaxOverlayEnabled,
      timeouts: {
        clearAllTimers,
        clearIdleTimer,
        clearStartupGrace,
      },
    })
  }, [
    backend,
    clearAllTimers,
    clearIdleTimer,
    clearStartupGrace,
    dispatch,
    resizingRef,
    syntaxOverlayEnabled,
  ])

  return {
    clearIdleTimer,
    clearStartupGrace,
    startStartupGrace,
  }
}

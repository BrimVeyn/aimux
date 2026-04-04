import { type MutableRefObject, useCallback, useEffect, useRef } from 'react'

import type { SessionBackend } from '../session-backend/types'
import type {
  AppAction,
  LayoutState,
  TabSession,
  TerminalModeState,
  WorkspaceSnapshotV1,
} from '../state/types'

import { logInputDebug } from '../debug/input-log'
import {
  createTerminalBounds,
  forEachSplitPaneRect,
  getSnapshotTrees,
  toTerminalContentSize,
} from '../state/layout-resize'

const IDLE_ACTIVITY_TIMEOUT_MS = 2_000

function clearTimeoutMap(timeouts: Map<string, ReturnType<typeof setTimeout>>): void {
  for (const timeout of timeouts.values()) {
    clearTimeout(timeout)
  }
  timeouts.clear()
}

function resizeSnapshotPanes(
  snapshot: WorkspaceSnapshotV1 | undefined,
  layoutRef: MutableRefObject<LayoutState>,
  backend: SessionBackend
): void {
  if (!snapshot) return
  const trees = getSnapshotTrees(snapshot)
  const bounds = createTerminalBounds(
    layoutRef.current.terminalCols,
    layoutRef.current.terminalRows
  )
  forEachSplitPaneRect(trees, bounds, (tabId, rect) => {
    const size = toTerminalContentSize(rect)
    backend.resizeTab(tabId, size.cols, size.rows)
  })
}

function hydrateAttachedSession(
  dispatch: (action: AppAction) => void,
  sessionId: string,
  workspaceSnapshot: WorkspaceSnapshotV1 | undefined,
  result: Awaited<ReturnType<SessionBackend['attach']>>,
  layoutRef: MutableRefObject<LayoutState>,
  backend: SessionBackend
): void {
  if (result) {
    dispatch({
      type: 'hydrate-workspace',
      tabs: result.tabs,
      activeTabId: result.activeTabId,
      layoutTree: workspaceSnapshot?.layoutTree,
      layoutTrees: workspaceSnapshot?.layoutTrees,
      tabGroupMap: workspaceSnapshot?.tabGroupMap,
    })
    resizeSnapshotPanes(workspaceSnapshot, layoutRef, backend)
    return
  }

  if (workspaceSnapshot) {
    dispatch({
      type: 'load-session',
      sessionId,
      workspaceSnapshot,
    })
    resizeSnapshotPanes(workspaceSnapshot, layoutRef, backend)
  }
}

interface BackendRuntimeOptions {
  backend: SessionBackend
  dispatch: (action: AppAction) => void
  activeTabId: string | null
  currentSessionId: string | null
  layoutRef: MutableRefObject<LayoutState>
  resizingRef: MutableRefObject<boolean>
  currentSessionWorkspaceSnapshot: Parameters<SessionBackend['attach']>[0]['workspaceSnapshot']
}

export interface TabRuntimeControls {
  clearIdleTimer: (tabId: string) => void
  clearStartupGrace: (tabId: string) => void
  startStartupGrace: (tabId: string, timeoutMs: number) => void
}

export function useBackendRuntime({
  backend,
  dispatch,
  activeTabId,
  currentSessionId,
  currentSessionWorkspaceSnapshot,
  layoutRef,
  resizingRef,
}: BackendRuntimeOptions): TabRuntimeControls {
  const idleTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const startupGraceTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const attachRequestIdRef = useRef(0)

  const clearIdleTimer = useCallback((tabId: string): void => {
    const timeout = idleTimeoutsRef.current.get(tabId)
    if (timeout) {
      clearTimeout(timeout)
      idleTimeoutsRef.current.delete(tabId)
    }
  }, [])

  const clearStartupGrace = useCallback((tabId: string): void => {
    const timeout = startupGraceTimeoutsRef.current.get(tabId)
    if (timeout) {
      clearTimeout(timeout)
      startupGraceTimeoutsRef.current.delete(tabId)
    }
  }, [])

  const startStartupGrace = useCallback(
    (tabId: string, timeoutMs: number): void => {
      clearStartupGrace(tabId)
      const timeout = setTimeout(() => {
        startupGraceTimeoutsRef.current.delete(tabId)
      }, timeoutMs)
      startupGraceTimeoutsRef.current.set(tabId, timeout)
    },
    [clearStartupGrace]
  )

  const isStartupGraceActive = useCallback((tabId: string): boolean => {
    return startupGraceTimeoutsRef.current.has(tabId)
  }, [])

  const scheduleIdle = useCallback(
    (tabId: string, timeoutMs: number): void => {
      clearIdleTimer(tabId)
      const timeout = setTimeout(() => {
        dispatch({ type: 'set-tab-activity', tabId, activity: 'idle' })
        idleTimeoutsRef.current.delete(tabId)
      }, timeoutMs)
      idleTimeoutsRef.current.set(tabId, timeout)
    },
    [clearIdleTimer, dispatch]
  )

  useEffect(() => {
    if (!currentSessionId) {
      attachRequestIdRef.current += 1
      return
    }

    const attachRequestId = attachRequestIdRef.current + 1
    attachRequestIdRef.current = attachRequestId
    let cancelled = false

    void backend
      .attach({
        sessionId: currentSessionId,
        cols: layoutRef.current.terminalCols,
        rows: layoutRef.current.terminalRows,
        workspaceSnapshot: currentSessionWorkspaceSnapshot,
      })
      .then((result) => {
        if (cancelled || attachRequestIdRef.current !== attachRequestId) {
          return
        }
        logInputDebug('app.backend.attachResult', {
          hasResult: !!result,
          tabs: result?.tabs.length ?? 0,
          activeTabId: result?.activeTabId ?? null,
        })
        hydrateAttachedSession(
          dispatch,
          currentSessionId,
          currentSessionWorkspaceSnapshot,
          result,
          layoutRef,
          backend
        )
      })
      .catch((error) => {
        if (cancelled || attachRequestIdRef.current !== attachRequestId) {
          return
        }
        logInputDebug('app.backend.attachError', {
          error: error instanceof Error ? error.message : String(error),
        })
        hydrateAttachedSession(
          dispatch,
          currentSessionId,
          currentSessionWorkspaceSnapshot,
          null,
          layoutRef,
          backend
        )
      })

    return () => {
      cancelled = true
    }
  }, [backend, currentSessionId, currentSessionWorkspaceSnapshot, dispatch, layoutRef])

  useEffect(() => {
    if (!currentSessionId) {
      return
    }

    backend.setActiveTab(activeTabId)
  }, [activeTabId, backend, currentSessionId])

  useEffect(() => {
    const idleTimeouts = idleTimeoutsRef.current
    const startupGraceTimeouts = startupGraceTimeoutsRef.current

    const handleRender = (
      tabId: string,
      viewport: TabSession['viewport'],
      terminalModes: TerminalModeState
    ) => {
      if (!viewport) {
        return
      }

      dispatch({ type: 'replace-tab-viewport', tabId, viewport, terminalModes })
      if (isStartupGraceActive(tabId) || resizingRef.current) {
        return
      }

      dispatch({ type: 'set-tab-activity', tabId, activity: 'busy' })
      scheduleIdle(tabId, IDLE_ACTIVITY_TIMEOUT_MS)
    }

    const handleExit = (tabId: string, exitCode: number) => {
      clearIdleTimer(tabId)
      clearStartupGrace(tabId)
      dispatch({ type: 'set-tab-status', tabId, status: 'exited', exitCode })
      dispatch({ type: 'set-tab-activity', tabId, activity: undefined })
    }

    const handleError = (tabId: string, message: string) => {
      clearIdleTimer(tabId)
      clearStartupGrace(tabId)
      dispatch({ type: 'set-tab-error', tabId, message })
    }

    backend.on('render', handleRender)
    backend.on('exit', handleExit)
    backend.on('error', handleError)

    return () => {
      clearTimeoutMap(idleTimeouts)
      clearTimeoutMap(startupGraceTimeouts)
      backend.off('render', handleRender)
      backend.off('exit', handleExit)
      backend.off('error', handleError)
      void backend.destroy(true)
    }
  }, [
    backend,
    clearIdleTimer,
    clearStartupGrace,
    dispatch,
    isStartupGraceActive,
    resizingRef,
    scheduleIdle,
  ])

  return {
    clearIdleTimer,
    clearStartupGrace,
    startStartupGrace,
  }
}

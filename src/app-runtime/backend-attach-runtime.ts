import type { MutableRefObject } from 'react'

import type { SessionBackend } from '../session-backend/types'
import type { AppAction, LayoutState, WorkspaceSnapshotV1 } from '../state/types'

import { logInputDebug } from '../debug/input-log'
import {
  createTerminalBounds,
  forEachSplitPaneRect,
  getSnapshotTrees,
  toTerminalContentSize,
} from '../state/layout-resize'

export function resizeSnapshotPanes(
  snapshot: WorkspaceSnapshotV1 | undefined,
  layoutRef: MutableRefObject<LayoutState>,
  backend: SessionBackend
): void {
  if (!snapshot) {
    return
  }

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
      activeTabId: result.activeTabId,
      layoutTree: workspaceSnapshot?.layoutTree,
      layoutTrees: workspaceSnapshot?.layoutTrees,
      tabGroupMap: workspaceSnapshot?.tabGroupMap,
      tabs: result.tabs,
      type: 'hydrate-workspace',
    })
    resizeSnapshotPanes(workspaceSnapshot, layoutRef, backend)
    return
  }

  if (!workspaceSnapshot) {
    return
  }

  dispatch({
    sessionId,
    type: 'load-session',
    workspaceSnapshot,
  })
  resizeSnapshotPanes(workspaceSnapshot, layoutRef, backend)
}

interface AttachCurrentSessionOptions {
  backend: SessionBackend
  dispatch: (action: AppAction) => void
  currentSessionId: string
  currentSessionWorkspaceSnapshot: Parameters<SessionBackend['attach']>[0]['workspaceSnapshot']
  layoutRef: MutableRefObject<LayoutState>
  attachRequestIdRef: MutableRefObject<number>
}

export function attachCurrentSession({
  attachRequestIdRef,
  backend,
  currentSessionId,
  currentSessionWorkspaceSnapshot,
  dispatch,
  layoutRef,
}: AttachCurrentSessionOptions): () => void {
  const attachRequestId = attachRequestIdRef.current + 1
  attachRequestIdRef.current = attachRequestId
  let cancelled = false

  void backend
    .attach({
      cols: layoutRef.current.terminalCols,
      rows: layoutRef.current.terminalRows,
      sessionId: currentSessionId,
      workspaceSnapshot: currentSessionWorkspaceSnapshot,
    })
    .then((result) => {
      if (cancelled || attachRequestIdRef.current !== attachRequestId) {
        return
      }

      logInputDebug('app.backend.attachResult', {
        activeTabId: result?.activeTabId ?? null,
        hasResult: !!result,
        tabs: result?.tabs.length ?? 0,
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
}

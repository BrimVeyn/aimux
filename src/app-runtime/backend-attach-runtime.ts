import type { MutableRefObject } from 'react'

import type { SessionBackend } from '../session-backend/types'
import type { AppAction, LayoutState, TabSession, WorkspaceSnapshotV1 } from '../state/types'

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

function mergeSnapshotTabMetadata(
  tabs: TabSession[],
  workspaceSnapshot: WorkspaceSnapshotV1 | undefined
): TabSession[] {
  if (!workspaceSnapshot) return tabs
  const persistedById = new Map(workspaceSnapshot.tabs.map((tab) => [tab.id, tab]))
  return tabs.map((tab) => {
    const persisted = persistedById.get(tab.id)
    return persisted?.worktreeId != null &&
      persisted?.worktreeId !== '' &&
      !(tab.worktreeId != null && tab.worktreeId !== '')
      ? { ...tab, worktreeId: persisted.worktreeId }
      : tab
  })
}

function hydrateAttachedSession(
  dispatch: (action: AppAction) => void,
  projectId: string,
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
      tabs: mergeSnapshotTabMetadata(result.tabs, workspaceSnapshot),
      type: 'hydrate-workspace',
    })
    // Dispatch the project-status snapshot *after* hydrate-workspace so
    // sidebar chips reflect per-project state on attach without waiting
    // for the next daemon-side status transition.
    for (const entry of result.initialProjectStatuses) {
      dispatch({ projectId: entry.projectId, status: entry.status, type: 'set-project-status' })
    }
    resizeSnapshotPanes(workspaceSnapshot, layoutRef, backend)
    return
  }

  if (!workspaceSnapshot) {
    return
  }

  dispatch({
    projectId,
    type: 'load-project',
    workspaceSnapshot,
  })
  resizeSnapshotPanes(workspaceSnapshot, layoutRef, backend)
}

interface AttachCurrentSessionOptions {
  backend: SessionBackend
  dispatch: (action: AppAction) => void
  currentProjectId: string
  currentProjectWorkspaceSnapshot: Parameters<SessionBackend['attach']>[0]['workspaceSnapshot']
  layoutRef: MutableRefObject<LayoutState>
  attachRequestIdRef: MutableRefObject<number>
}

export function attachCurrentSession({
  attachRequestIdRef,
  backend,
  currentProjectId,
  currentProjectWorkspaceSnapshot,
  dispatch,
  layoutRef,
}: AttachCurrentSessionOptions): () => void {
  const attachRequestId = attachRequestIdRef.current + 1
  attachRequestIdRef.current = attachRequestId
  let cancelled = false

  void (async () => {
    try {
      const result = await backend.attach({
        cols: layoutRef.current.terminalCols,
        projectId: currentProjectId,
        rows: layoutRef.current.terminalRows,
        workspaceSnapshot: currentProjectWorkspaceSnapshot,
      })
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
        currentProjectId,
        currentProjectWorkspaceSnapshot,
        result,
        layoutRef,
        backend
      )
    } catch (error) {
      if (cancelled || attachRequestIdRef.current !== attachRequestId) {
        return
      }

      logInputDebug('app.backend.attachError', {
        error: error instanceof Error ? error.message : String(error),
      })
      hydrateAttachedSession(
        dispatch,
        currentProjectId,
        currentProjectWorkspaceSnapshot,
        null,
        layoutRef,
        backend
      )
    }
  })()

  return () => {
    cancelled = true
  }
}

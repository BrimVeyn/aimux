import type { MutableRefObject } from 'react'

import type { SessionBackend } from '../session-backend/types'
import type { AppAction, LayoutState, ProjectSnapshotV1, TabSession } from '../state/types'

import { logInputDebug } from '../debug/input-log'
import {
  createTerminalBounds,
  forEachSplitPaneRect,
  getSnapshotTrees,
  toTerminalContentSize,
} from '../state/layout-resize'

export function resizeSnapshotPanes(
  snapshot: ProjectSnapshotV1 | undefined,
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
  projectSnapshot: ProjectSnapshotV1 | undefined
): TabSession[] {
  if (!projectSnapshot) return tabs
  const persistedById = new Map(projectSnapshot.tabs.map((tab) => [tab.id, tab]))
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
  projectSnapshot: ProjectSnapshotV1 | undefined,
  result: Awaited<ReturnType<SessionBackend['attach']>>,
  layoutRef: MutableRefObject<LayoutState>,
  backend: SessionBackend
): void {
  if (result) {
    dispatch({
      activeTabId: result.activeTabId,
      layoutTree: projectSnapshot?.layoutTree,
      layoutTrees: projectSnapshot?.layoutTrees,
      tabGroupMap: projectSnapshot?.tabGroupMap,
      tabs: mergeSnapshotTabMetadata(result.tabs, projectSnapshot),
      type: 'hydrate-project',
    })
    // Dispatch the project-status snapshot *after* hydrate-project so
    // sidebar chips reflect per-project state on attach without waiting
    // for the next daemon-side status transition.
    for (const entry of result.initialProjectStatuses) {
      dispatch({ projectId: entry.projectId, status: entry.status, type: 'set-project-status' })
    }
    resizeSnapshotPanes(projectSnapshot, layoutRef, backend)
    return
  }

  if (!projectSnapshot) {
    return
  }

  dispatch({
    projectId,
    projectSnapshot,
    type: 'load-project',
  })
  resizeSnapshotPanes(projectSnapshot, layoutRef, backend)
}

interface AttachCurrentSessionOptions {
  backend: SessionBackend
  dispatch: (action: AppAction) => void
  currentProjectId: string
  currentProjectProjectSnapshot: Parameters<SessionBackend['attach']>[0]['projectSnapshot']
  layoutRef: MutableRefObject<LayoutState>
  attachRequestIdRef: MutableRefObject<number>
}

export function attachCurrentSession({
  attachRequestIdRef,
  backend,
  currentProjectId,
  currentProjectProjectSnapshot,
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
        projectSnapshot: currentProjectProjectSnapshot,
        rows: layoutRef.current.terminalRows,
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
        currentProjectProjectSnapshot,
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
        currentProjectProjectSnapshot,
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

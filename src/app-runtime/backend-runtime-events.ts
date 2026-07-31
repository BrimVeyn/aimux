import type { MutableRefObject } from 'react'

import type { SessionBackend } from '../session-backend/types'
import type {
  AppAction,
  ProjectStatus,
  TabActivity,
  TabSession,
  TerminalModeState,
  WorkspaceRecord,
} from '../state/types'
import type { TabRuntimeTimeouts } from './tab-runtime-timeouts'

import { logInputDebug } from '../debug/input-log'
import { clearTabSyntaxState, highlightSnapshot } from '../integrations/claude-syntax-overlay'
import { appStore } from '../state/app-store'
import { loadProjectCatalog, saveProjectCatalog } from '../state/project-catalog'
import {
  handleCreateProjectEffect,
  handleDeleteProjectEffect,
  handleSwitchProjectEffect,
} from './project-actions'

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

  const handleProjectActivity = (projectId: string, status: ProjectStatus) => {
    logInputDebug('app.backend.event.projectActivity', { projectId, status })
    dispatch({ projectId, status, type: 'set-project-status' })
  }

  const handleTabActivity = (tabId: string, activity: TabActivity) => {
    logInputDebug('app.backend.event.tabActivity', { activity, tabId })
    dispatch({ activity, tabId, type: 'set-tab-activity' })
  }

  // Serialise project lifecycle handlers behind a small FIFO so back-to-back
  // switch/create/close broadcasts from multiple CLIs don't race the
  // in-flight `handleSwitchProjectEffect`. Every lifecycle handler awaits the
  // previous chain link before running.
  let lifecycleChain: Promise<void> = Promise.resolve()
  const enqueueLifecycle = (fn: () => void | Promise<void>): void => {
    const previous = lifecycleChain
    lifecycleChain = (async () => {
      await previous
      try {
        await fn()
      } catch (error) {
        logInputDebug('app.backend.event.lifecycle.error', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })()
  }

  const handleProjectCreateRequested = (
    name: string,
    projectPath: string | undefined,
    doSwitch: boolean
  ) => {
    enqueueLifecycle(() => {
      logInputDebug('app.backend.event.projectCreateRequested', { doSwitch, name, projectPath })
      const state = appStore.getState()
      handleCreateProjectEffect(state, dispatch, name, projectPath)
      if (doSwitch) {
        // The create dispatched `set-projects`+`load-project`; the new project
        // is now in the catalog + current. Loading already ran, so the switch
        // is effectively done — just tell the daemon so any --wait CLI exits.
        const created = appStore
          .getState()
          .projects.find((s) => s.name === name && s.projectPath === projectPath)
        if (created) backend.announceProjectSwitched(created.id)
      }
    })
  }

  const handleProjectSwitchRequested = (targetProjectId: string) => {
    enqueueLifecycle(async () => {
      logInputDebug('app.backend.event.projectSwitchRequested', { targetProjectId })
      let state = appStore.getState()
      let target = state.projects.find((s) => s.id === targetProjectId)
      if (!target) {
        // In-memory list is stale (e.g. daemon just added a project via the
        // headless path). Reload from disk and try once more before giving
        // up — the daemon already validated the catalog, so this should hit.
        const fresh = loadProjectCatalog()
        target = fresh.find((s) => s.id === targetProjectId)
        if (target) {
          dispatch({ projects: fresh, type: 'set-projects' })
          state = appStore.getState()
        }
      }
      if (!target) {
        // Announce anyway so any `--wait` CLI unblocks — better a spurious
        // exit than a 30s hang while the caller retries.
        logInputDebug('app.backend.event.projectSwitchRequested.notFound', { targetProjectId })
        backend.announceProjectSwitched(targetProjectId)
        return
      }
      handleSwitchProjectEffect(state, backend, dispatch, target)
      // Give the reducer a tick to settle before announcing — the switch
      // fires `set-projects`+`load-project` synchronously but the backend
      // re-attach happens async.
      await Promise.resolve()
      backend.announceProjectSwitched(targetProjectId)
    })
  }

  const handleProjectCloseRequested = (targetProjectId: string) => {
    enqueueLifecycle(() => {
      logInputDebug('app.backend.event.projectCloseRequested', { targetProjectId })
      const state = appStore.getState()
      handleDeleteProjectEffect(state, backend, dispatch, targetProjectId)
    })
  }

  const handleProjectSwitched = (projectId: string) => {
    // The daemon's own relay for --wait CLIs. UI side has no work to do —
    // logging is enough.
    logInputDebug('app.backend.event.projectSwitched', { projectId })
  }

  const handleWorkspaceAdded = (projectId: string, workspace: WorkspaceRecord) => {
    // Idempotent: skip if a duplicate id is already in the project (the CLI
    // may have raced the UI's own workspace-add path).
    const current = appStore.getState()
    const project = current.projects.find((s) => s.id === projectId)
    const already = project?.workspaces?.some((w) => w.id === workspace.id) === true
    if (already) {
      logInputDebug('app.backend.event.workspaceAdded.skipDuplicate', {
        projectId,
        workspaceId: workspace.id,
      })
      return
    }
    logInputDebug('app.backend.event.workspaceAdded', {
      projectId,
      workspaceId: workspace.id,
    })
    dispatch({ projectId, type: 'add-workspace-record', workspace })
    // Persist the catalog so the change survives restart even if no other
    // side-effect saves shortly after.
    saveProjectCatalog(appStore.getState().projects)
  }

  const handleWorkspaceRemoved = (projectId: string, workspaceId: string) => {
    const current = appStore.getState()
    const project = current.projects.find((s) => s.id === projectId)
    const present = project?.workspaces?.some((w) => w.id === workspaceId) === true
    if (!present) {
      logInputDebug('app.backend.event.workspaceRemoved.skipMissing', { projectId, workspaceId })
      return
    }
    logInputDebug('app.backend.event.workspaceRemoved', { projectId, workspaceId })
    // Build the updated projects list and dispatch via `set-projects` — this
    // matches the pattern used by the existing workspace-delete side-effect
    // and centralises the write in one action rather than adding a new one.
    const projects = current.projects.map((s) => {
      if (s.id !== projectId) return s
      const remaining = (s.workspaces ?? []).filter((w) => w.id !== workspaceId)
      return {
        ...s,
        activeWorkspaceId:
          s.activeWorkspaceId === workspaceId ? remaining[0]?.id : s.activeWorkspaceId,
        updatedAt: new Date().toISOString(),
        workspaces: remaining,
      }
    })
    saveProjectCatalog(projects)
    dispatch({ projects, type: 'set-projects' })
  }

  const handleTabAdded = (projectId: string, tab: TabSession) => {
    // Idempotent: the daemon broadcasts `tabAdded` for every createTab,
    // including the ones this UI process initiated (which already dispatched
    // `add-tab` locally). Skip the duplicate so we don't get two entries for
    // the same tab id.
    const current = appStore.getState()
    if (current.tabs.some((t) => t.id === tab.id)) {
      logInputDebug('app.backend.event.tabAdded.skipDuplicate', { projectId, tabId: tab.id })
      dispatch({
        autoRenameStatus: tab.autoRenameStatus,
        tabId: tab.id,
        type: 'update-tab-metadata',
      })
      return
    }
    if (current.currentProjectId !== projectId) {
      logInputDebug('app.backend.event.tabAdded.skipForeignProject', {
        currentProjectId: current.currentProjectId,
        projectId,
        tabId: tab.id,
      })
      return
    }
    logInputDebug('app.backend.event.tabAdded', { projectId, tabId: tab.id })
    dispatch({ tab, type: 'add-tab' })
  }

  const handleTabMetadataUpdated = (
    projectId: string,
    tabId: string,
    patch: { title?: string; autoRenameStatus?: 'eligible' | 'attempted' }
  ) => {
    if (appStore.getState().currentProjectId !== projectId) return
    dispatch({ ...patch, tabId, type: 'update-tab-metadata' })
  }

  backend.on('render', handleRender)
  backend.on('exit', handleExit)
  backend.on('error', handleError)
  backend.on('projectActivity', handleProjectActivity)
  backend.on('tabActivity', handleTabActivity)
  backend.on('tabAdded', handleTabAdded)
  backend.on('tabMetadataUpdated', handleTabMetadataUpdated)
  backend.on('projectCreateRequested', handleProjectCreateRequested)
  backend.on('projectSwitchRequested', handleProjectSwitchRequested)
  backend.on('projectCloseRequested', handleProjectCloseRequested)
  backend.on('projectSwitched', handleProjectSwitched)
  backend.on('workspaceAdded', handleWorkspaceAdded)
  backend.on('workspaceRemoved', handleWorkspaceRemoved)

  return () => {
    timeouts.clearAllTimers()
    backend.off('render', handleRender)
    backend.off('exit', handleExit)
    backend.off('error', handleError)
    backend.off('projectActivity', handleProjectActivity)
    backend.off('tabActivity', handleTabActivity)
    backend.off('tabAdded', handleTabAdded)
    backend.off('tabMetadataUpdated', handleTabMetadataUpdated)
    backend.off('projectCreateRequested', handleProjectCreateRequested)
    backend.off('projectSwitchRequested', handleProjectSwitchRequested)
    backend.off('projectCloseRequested', handleProjectCloseRequested)
    backend.off('projectSwitched', handleProjectSwitched)
    backend.off('workspaceAdded', handleWorkspaceAdded)
    backend.off('workspaceRemoved', handleWorkspaceRemoved)
    void backend.destroy(true)
  }
}

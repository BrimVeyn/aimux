import type { MutableRefObject } from 'react'

import type { SessionBackend } from '../session-backend/types'
import type {
  AppAction,
  SessionStatus,
  TabActivity,
  TabSession,
  TerminalModeState,
  WorktreeRecord,
} from '../state/types'
import type { TabRuntimeTimeouts } from './tab-runtime-timeouts'

import { logInputDebug } from '../debug/input-log'
import { clearTabSyntaxState, highlightSnapshot } from '../integrations/claude-syntax-overlay'
import { appStore } from '../state/app-store'
import { saveSessionCatalog } from '../state/session-catalog'
import {
  handleCreateSessionEffect,
  handleDeleteSessionEffect,
  handleSwitchSessionEffect,
} from './session-actions'

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

  // Serialise workspace lifecycle handlers behind a small FIFO so back-to-back
  // switch/create/close broadcasts from multiple CLIs don't race the
  // in-flight `handleSwitchSessionEffect`. Every lifecycle handler awaits the
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

  const handleWorkspaceCreateRequested = (
    name: string,
    projectPath: string | undefined,
    doSwitch: boolean
  ) => {
    enqueueLifecycle(() => {
      logInputDebug('app.backend.event.workspaceCreateRequested', { doSwitch, name, projectPath })
      const state = appStore.getState()
      handleCreateSessionEffect(state, dispatch, name, projectPath)
      if (doSwitch) {
        // The create dispatched `set-sessions`+`load-session`; the new session
        // is now in the catalog + current. Loading already ran, so the switch
        // is effectively done — just tell the daemon so any --wait CLI exits.
        const created = appStore
          .getState()
          .sessions.find((s) => s.name === name && s.projectPath === projectPath)
        if (created) backend.announceWorkspaceSwitched(created.id)
      }
    })
  }

  const handleWorkspaceSwitchRequested = (targetSessionId: string) => {
    enqueueLifecycle(async () => {
      logInputDebug('app.backend.event.workspaceSwitchRequested', { targetSessionId })
      const state = appStore.getState()
      const target = state.sessions.find((s) => s.id === targetSessionId)
      if (!target) {
        logInputDebug('app.backend.event.workspaceSwitchRequested.notFound', { targetSessionId })
        return
      }
      handleSwitchSessionEffect(state, backend, dispatch, target)
      // Give the reducer a tick to settle before announcing — the switch
      // fires `set-sessions`+`load-session` synchronously but the backend
      // re-attach happens async.
      await Promise.resolve()
      backend.announceWorkspaceSwitched(targetSessionId)
    })
  }

  const handleWorkspaceCloseRequested = (targetSessionId: string) => {
    enqueueLifecycle(() => {
      logInputDebug('app.backend.event.workspaceCloseRequested', { targetSessionId })
      const state = appStore.getState()
      handleDeleteSessionEffect(state, backend, dispatch, targetSessionId)
    })
  }

  const handleWorkspaceSwitched = (sessionId: string) => {
    // The daemon's own relay for --wait CLIs. UI side has no work to do —
    // logging is enough.
    logInputDebug('app.backend.event.workspaceSwitched', { sessionId })
  }

  const handleWorktreeAdded = (sessionId: string, worktree: WorktreeRecord) => {
    // Idempotent: skip if a duplicate id is already in the session (the CLI
    // may have raced the UI's own worktree-add path).
    const current = appStore.getState()
    const session = current.sessions.find((s) => s.id === sessionId)
    const already = session?.worktrees?.some((w) => w.id === worktree.id) === true
    if (already) {
      logInputDebug('app.backend.event.worktreeAdded.skipDuplicate', {
        sessionId,
        worktreeId: worktree.id,
      })
      return
    }
    logInputDebug('app.backend.event.worktreeAdded', {
      sessionId,
      worktreeId: worktree.id,
    })
    dispatch({ sessionId, type: 'add-worktree-record', worktree })
    // Persist the catalog so the change survives restart even if no other
    // side-effect saves shortly after.
    saveSessionCatalog(appStore.getState().sessions)
  }

  const handleWorktreeRemoved = (sessionId: string, worktreeId: string) => {
    const current = appStore.getState()
    const session = current.sessions.find((s) => s.id === sessionId)
    const present = session?.worktrees?.some((w) => w.id === worktreeId) === true
    if (!present) {
      logInputDebug('app.backend.event.worktreeRemoved.skipMissing', { sessionId, worktreeId })
      return
    }
    logInputDebug('app.backend.event.worktreeRemoved', { sessionId, worktreeId })
    // Build the updated sessions list and dispatch via `set-sessions` — this
    // matches the pattern used by the existing worktree-delete side-effect
    // and centralises the write in one action rather than adding a new one.
    const sessions = current.sessions.map((s) => {
      if (s.id !== sessionId) return s
      const remaining = (s.worktrees ?? []).filter((w) => w.id !== worktreeId)
      return {
        ...s,
        activeWorktreeId: s.activeWorktreeId === worktreeId ? remaining[0]?.id : s.activeWorktreeId,
        updatedAt: new Date().toISOString(),
        worktrees: remaining,
      }
    })
    saveSessionCatalog(sessions)
    dispatch({ sessions, type: 'set-sessions' })
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
  backend.on('workspaceCreateRequested', handleWorkspaceCreateRequested)
  backend.on('workspaceSwitchRequested', handleWorkspaceSwitchRequested)
  backend.on('workspaceCloseRequested', handleWorkspaceCloseRequested)
  backend.on('workspaceSwitched', handleWorkspaceSwitched)
  backend.on('worktreeAdded', handleWorktreeAdded)
  backend.on('worktreeRemoved', handleWorktreeRemoved)

  return () => {
    timeouts.clearAllTimers()
    backend.off('render', handleRender)
    backend.off('exit', handleExit)
    backend.off('error', handleError)
    backend.off('sessionActivity', handleSessionActivity)
    backend.off('tabActivity', handleTabActivity)
    backend.off('tabAdded', handleTabAdded)
    backend.off('workspaceCreateRequested', handleWorkspaceCreateRequested)
    backend.off('workspaceSwitchRequested', handleWorkspaceSwitchRequested)
    backend.off('workspaceCloseRequested', handleWorkspaceCloseRequested)
    backend.off('workspaceSwitched', handleWorkspaceSwitched)
    backend.off('worktreeAdded', handleWorktreeAdded)
    backend.off('worktreeRemoved', handleWorktreeRemoved)
    void backend.destroy(true)
  }
}

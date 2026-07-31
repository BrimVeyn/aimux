import type { CliRenderer } from '@opentui/core'

import {
  DEFAULT_EDITOR_ARGS,
  getExternalEditorConfig,
  isAutoCommitEnabled,
  KNOWN_GUI_EDITORS,
} from '@brimveyn/aimux-config'
import { $ } from 'bun'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join as joinPath, resolve as resolvePath } from 'node:path'

import type { SideEffect } from '../input/modes/types'
import type { SessionBackend } from '../session-backend/types'
import type {
  AppAction,
  AppState,
  AssistantId,
  PendingWorkspaceLaunch,
  TabSession,
  WorkspaceRecord,
} from '../state/types'
import type { ThemeId } from '../ui/themes'

import {
  loadConfig,
  saveConfig,
  type WorkspaceTemplate,
  type WorkspaceTemplatePane,
} from '../config'
import { logInputDebug } from '../debug/input-log'
import { enqueueGitOp } from '../git/command-queue'
import { countDirtyFiles, moveWorkspace } from '../git/move-workspace'
import {
  createGitWorktree,
  deleteGitBranch,
  getCurrentBranch,
  getDefaultBranch,
  getHeadSha,
  getMainWorktreeRoot,
  listGitWorktrees,
  listLocalBranches,
  pruneGitWorktrees,
  removeGitWorktree,
} from '../git/worktree'
import { createPrefixedId } from '../platform/id'
import {
  assertSafeAimuxWorktreePath,
  isInsideAimuxWorktreeRoot,
  makeWorktreePath,
  sanitizePathSegment,
} from '../platform/worktree-paths'
import { getProfileConfigDir } from '../profile-paths'
import {
  getAllAssistantOptions,
  getAssistantOption,
  isCommandAvailable,
  parseCommand,
} from '../pty/command-registry'
import { appStore } from '../state/app-store'
import { createTerminalBounds } from '../state/layout-resize'
import {
  allLeafIds,
  computePaneRects,
  createLeaf,
  getGroupIdForTab,
  getTreeForTab,
  PANE_BORDER,
  type SplitDirection,
  splitNode,
} from '../state/layout-tree'
import { saveProjectCatalog } from '../state/project-catalog'
import { pruneSnapshotOfWorkspace } from '../state/project-persistence'
import { saveCurrentProject } from '../state/project-save'
import {
  acceptsTabs,
  filterTabsForActiveWorkspace,
  getActiveWorkspace,
  getActiveWorkspacePath,
  getPrimaryWorkspace,
  withActiveWorkspace,
} from '../state/project-workspaces'
import { filterProjects, filterSnippets, getNewTabAssistantOptions } from '../state/selectors'
import { getSnippetsCatalogPath, isConfigSnippetId } from '../state/snippet-catalog'
import { appReducer } from '../state/store'
import { buildTabEntries } from '../state/tab-entries'
import { createDefaultTerminalModes } from '../state/terminal-modes'
import { toast } from '../state/toast-store'
import { filterThemeIds } from '../ui/filter-themes'
import { scrollGitDiff } from '../ui/git-view-controls'
import { applyTheme, getCurrentMode, getTransparent, setMode, setTransparent } from '../ui/theme'
import { triggerAutoCommitNow } from './auto-commit-ref'
import {
  handleCreateProjectEffect,
  handleDeleteProjectEffect,
  handleRenameProjectEffect,
  handleSwitchProjectEffect,
  restartTabSession,
  switchProjectRecords,
} from './project-actions'
import { injectPromptWhenReady } from './prompt-injection'
import { writeToTab } from './pty-write'
import {
  handleDeleteSnippetEffect,
  handleSaveSnippetEditorEffect,
  pasteSnippetToTab,
} from './snippet-actions'
import { placeholderWorkspaceName, renameWorkspaceFromPrompt } from './workspace-naming'

const STARTUP_GRACE_MS = 5_000
/**
 * Delay before injecting a template pane's `send` payload into its PTY.
 * Short enough that shells (which print a prompt within ~100 ms) receive the
 * command after their prompt is drawn; long enough to clear most PTY init
 * races. Not tied to STARTUP_GRACE_MS because that is the assistant timeout,
 * not a readiness signal. See review note: a `tab.status === 'running'`
 * subscription would be more robust and is the planned follow-up.
 */
const TEMPLATE_SEND_DELAY_MS = 600

export interface SideEffectContext {
  state: AppState
  dispatch: (action: AppAction) => void
  backend: SessionBackend
  renderer: CliRenderer
  themeId: ThemeId
  setThemeId: (id: ThemeId) => void
  activeTab: TabSession | undefined
  clearIdleTimer: (tabId: string) => void
  clearStartupGrace: (tabId: string) => void
  startStartupGrace: (tabId: string, timeoutMs: number) => void
  getState: () => AppState
  getCurrentProjectProjectPath: () => string | undefined
}

function getSelectedAssistantOption(state: AppState) {
  const newTab = state.modal.type === 'new-tab' ? state.modal : null
  const list = getNewTabAssistantOptions(
    state.customCommands,
    newTab?.editBuffer ?? null,
    newTab?.pendingWorkspace != null
  )
  return list[state.modal.selectedIndex] ?? list[0] ?? getAssistantOption(0)
}

function handleProjectSelection(ctx: SideEffectContext): void {
  const { backend, dispatch, state } = ctx
  const selectedProject = getSelectedProject(state)
  logInputDebug('app.projectPicker.confirm', {
    creatingNew: !selectedProject,
    selectedIndex: state.modal.selectedIndex,
    selectedProjectId: selectedProject?.id ?? null,
  })

  if (selectedProject) {
    handleSwitchProjectEffect(state, backend, dispatch, selectedProject)
    return
  }

  dispatch({ returnToProjectPicker: true, type: 'open-create-project-modal' })
}

function handleSelectedProjectDelete(ctx: SideEffectContext): void {
  const { backend, dispatch, state } = ctx
  const selectedProject = getSelectedProject(state)
  logInputDebug('app.projectPicker.deleteSelected', {
    selectedIndex: state.modal.selectedIndex,
    selectedProjectId: selectedProject?.id ?? null,
  })

  if (selectedProject) {
    handleDeleteProjectEffect(state, backend, dispatch, selectedProject.id, {
      openProjectPicker: true,
    })
  }
}

function openSelectedProjectRename(ctx: SideEffectContext): void {
  const { dispatch, state } = ctx
  const selectedProject = getSelectedProject(state)
  if (!selectedProject) {
    return
  }

  logInputDebug('app.projectPicker.openRenameModal', {
    selectedIndex: state.modal.selectedIndex,
    selectedProjectId: selectedProject.id,
  })
  dispatch({
    initialName: selectedProject.name,
    projectTargetId: selectedProject.id,
    type: 'open-project-name-modal',
  })
}

function pasteSnippetToActiveGroup(ctx: SideEffectContext): void {
  const { activeTab, backend, state } = ctx
  const snippet = getSelectedSnippet(state)
  if (!snippet || !(state.activeTabId != null && state.activeTabId !== '')) {
    return
  }

  const groupId = getGroupIdForTab(state.tabGroupMap, state.activeTabId)
  const groupTree = groupId != null && groupId !== '' ? state.layoutTrees[groupId] : null
  if (!groupTree) {
    pasteSnippetToTab(backend, state.activeTabId, activeTab, snippet)
    return
  }

  for (const tabId of allLeafIds(groupTree)) {
    const tab = state.tabs.find((entry) => entry.id === tabId)
    if (tab) {
      pasteSnippetToTab(backend, tabId, tab, snippet)
    }
  }
}

function saveCustomCommandSelection(ctx: SideEffectContext): void {
  const { dispatch, state } = ctx
  if (state.modal.type !== 'new-tab' || state.modal.editingCommand === null) {
    return
  }
  const assistantId = state.modal.editingCommand
  if (state.modal.editBuffer === null) return

  const trimmed = state.modal.editBuffer.trim()
  const newCustomCommands = { ...state.customCommands }
  if (trimmed) {
    newCustomCommands[assistantId] = trimmed
  } else {
    delete newCustomCommands[assistantId]
  }

  saveConfig({
    ...loadConfig(),
    customCommands: newCustomCommands,
  })
  dispatch({ customCommands: newCustomCommands, type: 'set-custom-commands' })
  dispatch({ type: 'cancel-command-edit' })
}

function applyThemeEffect(
  effect: Extract<SideEffect, { type: 'apply-theme' }>,
  ctx: SideEffectContext
): void {
  const { state } = ctx
  const filter = state.modal.type === 'theme-picker' ? state.modal.editBuffer : null
  const ids = filterThemeIds(filter)

  switch (effect.action) {
    case 'open':
      applyTheme(ctx.themeId)
      return
    case 'restore':
      applyTheme(ctx.themeId)
      return
    case 'confirm': {
      const selectedId = ids[state.modal.selectedIndex]
      if (selectedId != null && selectedId !== '') {
        applyTheme(selectedId)
        ctx.setThemeId(selectedId)
        saveConfig({ ...loadConfig(), themeId: selectedId })
      }
      return
    }
    case 'preview': {
      if (ids.length === 0) return
      const nextIndex = (state.modal.selectedIndex + effect.delta + ids.length) % ids.length
      const previewId = ids[nextIndex]
      if (previewId != null && previewId !== '') {
        applyTheme(previewId)
      }
      return
    }
  }
}

function confirmSplitSelection(ctx: SideEffectContext): void {
  const { dispatch, state } = ctx
  const option = getSelectedAssistantOption(state)
  const direction = state.modal.type === 'split-picker' ? state.modal.splitDirection : 'vertical'
  const customCommand = state.customCommands[option.id]
  const tab = createTabSession(
    option.id,
    customCommand,
    state.customCommands,
    getActiveWorkspace(
      state.currentProjectId != null && state.currentProjectId !== ''
        ? state.projects.find((s) => s.id === state.currentProjectId)
        : undefined
    )?.id
  )
  dispatch({ type: 'close-modal' })
  executeSplitPane(ctx, direction, tab)
  dispatch({ focusMode: 'terminal-input', type: 'set-focus-mode' })
}

function createTabId(): string {
  return createPrefixedId('tab')
}

function getSelectedProject(state: AppState) {
  const filter = state.modal.type === 'project-picker' ? state.modal.editBuffer : null
  return filterProjects(state.projects, filter)[state.modal.selectedIndex]
}

function getSelectedSnippet(state: AppState) {
  const filter = state.modal.type === 'snippet-picker' ? state.modal.editBuffer : null
  return filterSnippets(state.snippets, filter)[state.modal.selectedIndex]
}

export function createTabSession(
  assistant: AssistantId,
  customCommand?: string,
  customCommands?: Record<string, string>,
  workspaceId?: string
): TabSession {
  const allOptions = getAllAssistantOptions(customCommands ?? {})
  const option = allOptions.find((o) => o.id === assistant) ?? getAssistantOption(0)

  return {
    activity: 'idle',
    assistant,
    buffer: '',
    command: customCommand ?? option.command,
    id: createTabId(),
    status: 'starting',
    terminalModes: createDefaultTerminalModes(),
    title: option.label,
    workspaceId,
  }
}

export function startTabSession(
  backend: SessionBackend,
  dispatch: (action: AppAction) => void,
  clearStartupGrace: (tabId: string) => void,
  startStartupGrace: (tabId: string) => void,
  tab: Pick<TabSession, 'id' | 'assistant' | 'title' | 'command' | 'workspaceId'>,
  cols: number,
  rows: number,
  cwd?: string,
  autoRenameCandidate = true
): void {
  logInputDebug('app.tab.start.request', {
    cols,
    command: tab.command,
    cwd: cwd ?? null,
    rows,
    tabId: tab.id,
    title: tab.title,
    workspaceId: tab.workspaceId ?? null,
  })
  startStartupGrace(tab.id)

  const { args, executable } = parseCommand(tab.command)

  if (!isCommandAvailable(executable)) {
    clearStartupGrace(tab.id)
    dispatch({
      message: `[command not found] ${executable} is not available in PATH.`,
      tabId: tab.id,
      type: 'set-tab-error',
    })
    return
  }

  backend.createSession({
    args,
    assistant: tab.assistant,
    autoRenameCandidate,
    cols,
    command: executable,
    cwd,
    rows,
    tabId: tab.id,
    title: tab.title,
    workspaceId: tab.workspaceId,
  })
}

/** Returns the id of the tab it created, so a caller can write into it. */
function launchAssistant(
  ctx: SideEffectContext,
  assistant: AssistantId,
  workspaceId?: string
): string {
  const { backend, clearStartupGrace, dispatch, startStartupGrace, state } = ctx
  const customCommand = state.customCommands[assistant]
  const tab = createTabSession(
    assistant,
    customCommand,
    state.customCommands,
    workspaceId ??
      getActiveWorkspace(
        state.currentProjectId != null && state.currentProjectId !== ''
          ? state.projects.find((s) => s.id === state.currentProjectId)
          : undefined
      )?.id
  )
  logInputDebug('app.launchAssistant', {
    assistant,
    command: tab.command,
    tabId: tab.id,
  })
  dispatch({ tab, type: 'add-tab' })
  dispatch({ focusMode: 'terminal-input', type: 'set-focus-mode' })
  startTabSession(
    backend,
    dispatch,
    clearStartupGrace,
    (tabId) => startStartupGrace(tabId, STARTUP_GRACE_MS),
    tab,
    state.layout.terminalCols,
    state.layout.terminalRows,
    getTabProjectPath(ctx, tab)
  )
  return tab.id
}

/**
 * Second half of the `<C-p>` flow, once the assistant is known: hand it the
 * prompt and rename the workspace after what the prompt describes. Both are
 * background work that must never block or fail the launch itself.
 */
function startPendingWorkspaceLaunch(
  ctx: SideEffectContext,
  pending: PendingWorkspaceLaunch,
  assistant: AssistantId,
  tabId: string
): void {
  void injectPromptWhenReady({
    backend: ctx.backend,
    getState: ctx.getState,
    prompt: pending.prompt,
    tabId,
  })

  const workspace = ctx
    .getState()
    .projects.find((entry) => entry.id === pending.projectId)
    ?.workspaces?.find((entry) => entry.id === pending.workspaceId)
  if (!workspace) return

  void renameWorkspaceFromPrompt(
    { projectId: pending.projectId, prompt: pending.prompt, provider: assistant, workspace },
    {
      applyName: (projectId, workspaceId, patch) =>
        ctx.dispatch({ patch, projectId, type: 'update-workspace-record', workspaceId }),
    }
  )
}

/**
 * The `<C-p>` flow: create a workspace in the current project, then hand off.
 * A template already produces tabs, so it wins; otherwise we chain into the
 * new-tab modal rather than leaving the user in an empty workspace.
 */
async function createWorkspaceFromModal(
  ctx: SideEffectContext,
  projectId: string,
  params: {
    prompt: string
    baseRef?: string
    templateId?: string
  }
): Promise<void> {
  // A name derived locally from the prompt, so the sidebar reads right from the
  // first frame. The model-generated one replaces it a few seconds later.
  // The branch is left to `createAimuxTempWorkspace`, which suffixes it with a
  // timestamp: two workspaces started from the same prompt must not collide on
  // the branch name before the model has had a chance to distinguish them.
  const workspace = await createAimuxTempWorkspace(
    ctx,
    projectId,
    placeholderWorkspaceName(params.prompt),
    undefined,
    params.baseRef
  )
  // Undefined means the create was rejected (e.g. branch already checked out);
  // the modal stays open showing the error.
  if (!workspace) return

  const template =
    params.templateId != null && params.templateId !== ''
      ? ctx.state.workspaceTemplates.find((entry) => entry.id === params.templateId)
      : undefined

  ctx.dispatch({ type: 'close-modal' })

  if (template) {
    // A template picks its own assistants, so there is nobody to hand the
    // prompt to and no provider to name with: the local name is the final one.
    applyWorkspaceTemplate(ctx, template, workspace.id, workspace.path)
    ctx.dispatch({ focusMode: 'terminal-input', type: 'set-focus-mode' })
    return
  }

  ctx.dispatch({
    pendingWorkspace: { projectId, prompt: params.prompt, workspaceId: workspace.id },
    type: 'open-new-tab-modal',
  })
}

function applyWorkspaceTemplate(
  ctx: SideEffectContext,
  template: WorkspaceTemplate,
  workspaceId: string,
  workspacePath: string
): void {
  let firstTabId: string | null = null

  for (const templateTab of template.tabs) {
    const localToTabId = new Map<string, string>()

    for (let i = 0; i < templateTab.panes.length; i++) {
      const pane = templateTab.panes[i]
      if (!pane) continue
      const tab = createPaneTab(ctx, pane, workspaceId)
      localToTabId.set(pane.id, tab.id)

      if (i === 0) {
        if (firstTabId == null) firstTabId = tab.id
        ctx.dispatch({ tab, type: 'add-tab' })
        startTabSession(
          ctx.backend,
          ctx.dispatch,
          ctx.clearStartupGrace,
          (tabId) => ctx.startStartupGrace(tabId, STARTUP_GRACE_MS),
          tab,
          ctx.state.layout.terminalCols,
          ctx.state.layout.terminalRows,
          workspacePath
        )
      } else {
        const splitFromId =
          pane.splitFrom != null && pane.splitFrom !== ''
            ? localToTabId.get(pane.splitFrom)
            : undefined
        const direction: SplitDirection = pane.direction ?? 'vertical'
        if (splitFromId == null || splitFromId === '') {
          logInputDebug('template.splitFrom.unresolved', {
            paneId: pane.id,
            splitFrom: pane.splitFrom ?? null,
            templateId: template.id,
          })
          continue
        }
        splitFromTab(ctx, splitFromId, direction, tab, workspacePath)
        if (pane.ratio != null) {
          const sourceRatio = clampSplitRatio(1 - pane.ratio)
          ctx.dispatch({
            axis: direction,
            ratio: sourceRatio,
            tabId: tab.id,
            type: 'set-split-ratio',
          })
        }
      }

      if (pane.send != null && pane.send !== '') {
        const payload = `${pane.send}\n`
        const targetTabId = tab.id
        setTimeout(() => {
          const latest = ctx.getState()
          const latestTab = latest.tabs.find((entry) => entry.id === targetTabId)
          writeToTab(ctx.backend, targetTabId, latestTab, payload)
        }, TEMPLATE_SEND_DELAY_MS)
      }
    }
  }

  if (firstTabId != null) {
    ctx.dispatch({ tabId: firstTabId, type: 'set-active-tab' })
  }
}

function createPaneTab(
  ctx: SideEffectContext,
  pane: WorkspaceTemplatePane,
  workspaceId: string
): TabSession {
  // Accept `'shell'` as an alias for the registered `'terminal'` assistant so
  // template examples using the more intuitive name don't silently fall back
  // to Claude (createTabSession's unknown-id fallback resolves to index 0).
  const assistantId = (pane.assistant === 'shell' ? 'terminal' : pane.assistant) as AssistantId
  const customCommand = ctx.state.customCommands[assistantId]
  return createTabSession(assistantId, customCommand, ctx.state.customCommands, workspaceId)
}

function splitFromTab(
  ctx: SideEffectContext,
  baseTabId: string,
  direction: SplitDirection,
  newTab: TabSession,
  cwd?: string
): void {
  ctx.dispatch({ tabId: baseTabId, type: 'set-active-tab' })

  const latest = ctx.getState()
  const existingTree = getTreeForTab(latest.layoutTrees, latest.tabGroupMap, baseTabId)
  const baseTree = existingTree ?? createLeaf(baseTabId)
  const newTree = splitNode(baseTree, baseTabId, direction, newTab.id)
  const bounds = createTerminalBounds(latest.layout.terminalCols, latest.layout.terminalRows)
  const paneRect = computePaneRects(newTree, bounds).get(newTab.id)

  ctx.dispatch({ direction, newTab, type: 'split-pane' })
  startTabSession(
    ctx.backend,
    ctx.dispatch,
    ctx.clearStartupGrace,
    (tabId) => ctx.startStartupGrace(tabId, STARTUP_GRACE_MS),
    newTab,
    Math.max(1, (paneRect?.cols ?? latest.layout.terminalCols) - PANE_BORDER * 2),
    Math.max(1, (paneRect?.rows ?? latest.layout.terminalRows) - PANE_BORDER * 2),
    cwd
  )
}

function clampSplitRatio(value: number): number {
  if (!Number.isFinite(value)) return 0.5
  return Math.min(0.85, Math.max(0.15, value))
}

function getTabProjectPath(
  ctx: SideEffectContext,
  tab: Pick<TabSession, 'workspaceId'>
): string | undefined {
  const project =
    ctx.state.currentProjectId != null && ctx.state.currentProjectId !== ''
      ? ctx.state.projects.find((entry) => entry.id === ctx.state.currentProjectId)
      : undefined
  if (tab.workspaceId != null && tab.workspaceId !== '') {
    const workspace = project?.workspaces?.find((entry) => entry.id === tab.workspaceId)
    if (workspace) return workspace.path
  }
  return ctx.getCurrentProjectProjectPath()
}

function startExistingTab(ctx: SideEffectContext, tab: TabSession): void {
  const { backend, clearStartupGrace, dispatch, startStartupGrace, state } = ctx
  startTabSession(
    backend,
    dispatch,
    clearStartupGrace,
    (tabId) => startStartupGrace(tabId, STARTUP_GRACE_MS),
    tab,
    state.layout.terminalCols,
    state.layout.terminalRows,
    getTabProjectPath(ctx, tab),
    false
  )
}

function executeSplitPane(
  ctx: SideEffectContext,
  direction: SplitDirection,
  tab: TabSession
): void {
  const { backend, clearStartupGrace, dispatch, startStartupGrace, state } = ctx
  const activeTabId = state.activeTabId
  if (!(activeTabId != null && activeTabId !== '')) {
    return
  }

  const existingTree = getTreeForTab(state.layoutTrees, state.tabGroupMap, activeTabId)
  const baseTree = existingTree ?? createLeaf(activeTabId)
  const newTree = splitNode(baseTree, activeTabId, direction, tab.id)
  const bounds = createTerminalBounds(state.layout.terminalCols, state.layout.terminalRows)
  const paneRect = computePaneRects(newTree, bounds).get(tab.id)

  dispatch({ direction, newTab: tab, type: 'split-pane' })
  startTabSession(
    backend,
    dispatch,
    clearStartupGrace,
    (tabId) => startStartupGrace(tabId, STARTUP_GRACE_MS),
    tab,
    Math.max(1, (paneRect?.cols ?? state.layout.terminalCols) - PANE_BORDER * 2),
    Math.max(1, (paneRect?.rows ?? state.layout.terminalRows) - PANE_BORDER * 2),
    getTabProjectPath(ctx, tab)
  )
}

export function executeSideEffect(effect: SideEffect, ctx: SideEffectContext): void {
  const { backend, dispatch, state } = ctx

  switch (effect.type) {
    case 'quit': {
      saveCurrentProject(effect.state)
      void backend.destroy(true)
      ctx.renderer.destroy()
      process.exit(0)
      return
    }
    case 'open-new-tab': {
      // aimux never works on the primary checkout: tabs belong to a workspace,
      // so asking for one where there is no workspace asks for the workspace
      // instead. Every entry point — `<C-n>`, the tab bar's `+`, the empty pane
      // — routes here, so none of them has to know the rule.
      const project = state.projects.find((entry) => entry.id === state.currentProjectId)
      if (!project) {
        toast.error('Open a project first — <C-g>')
        return
      }
      if (acceptsTabs(project)) {
        dispatch({ type: 'open-new-tab-modal' })
        return
      }
      dispatch({ type: 'open-create-workspace-modal' })
      executeSideEffect({ type: 'load-create-workspace-base-branches' }, ctx)
      return
    }
    case 'launch-selected-assistant': {
      const assistant = getSelectedAssistantOption(state).id
      // Chained from `<C-p>`: pin the tab to the workspace just created, hand it
      // the prompt, and name the workspace with the assistant the user picked.
      // Otherwise the tab lands in the project's active workspace, which
      // launchAssistant resolves itself.
      const pending = state.modal.type === 'new-tab' ? state.modal.pendingWorkspace : undefined
      logInputDebug('app.launchSelectedAssistant', {
        assistant,
        chained: pending != null,
        modal: state.modal.type,
      })
      const tabId = launchAssistant(ctx, assistant, pending?.workspaceId)
      if (pending) startPendingWorkspaceLaunch(ctx, pending, assistant, tabId)
      return
    }
    case 'edit-selected-assistant': {
      const option = getSelectedAssistantOption(state)
      dispatch({ assistantId: option.id, type: 'open-edit-custom-command' })
      return
    }
    case 'load-create-workspace-base-branches': {
      void (async () => {
        const project = state.projects.find((entry) => entry.id === state.currentProjectId)
        const sourcePath = getActiveWorkspace(project)?.path ?? getActiveWorkspacePath(project)
        if (!(sourcePath != null && sourcePath !== '')) return
        const [branches, defaultBranch] = await Promise.all([
          listLocalBranches(sourcePath),
          getDefaultBranch(sourcePath),
        ])
        if (ctx.getState().modal.type !== 'create-workspace') return
        ctx.dispatch({ branches, defaultBranch, type: 'set-create-workspace-base-branches' })
      })()
      return
    }
    case 'create-workspace': {
      if (state.modal.type !== 'create-workspace') return
      // Templates get their own step: first Enter on the form advances to the
      // picker, the second one (step 'template') actually creates.
      if (state.modal.step === 'form' && state.workspaceTemplates.length > 0) {
        dispatch({ step: 'template', type: 'set-create-workspace-step' })
        return
      }
      const projectId = state.currentProjectId
      if (!(projectId != null && projectId !== '')) return
      const { baseRef, prompt } = state.modal
      const templateId =
        state.modal.step === 'template'
          ? state.workspaceTemplates[state.modal.selectedIndex]?.id
          : undefined
      void (async () => {
        try {
          await enqueueGitOp(async () =>
            createWorkspaceFromModal(ctx, projectId, {
              baseRef: baseRef !== '' ? baseRef : undefined,
              prompt,
              templateId,
            })
          )
        } catch (error) {
          toast.error(error instanceof Error ? error.message : String(error))
        }
      })()
      return
    }
    case 'confirm-selected-project': {
      handleProjectSelection(ctx)
      return
    }
    case 'delete-selected-project': {
      handleSelectedProjectDelete(ctx)
      return
    }
    case 'delete-project': {
      handleDeleteProjectEffect(state, backend, dispatch, effect.projectId)
      return
    }
    case 'delete-workspace': {
      void (async () => {
        try {
          await enqueueGitOp(async () =>
            runDeleteWorkspace(
              { ...ctx, state: ctx.getState() },
              effect.projectId,
              effect.workspaceId,
              !!(effect.force === true),
              !!(effect.closeTabs === true)
            )
          )
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          // Real errors surface as a toast. Recoverable failures (dirty tree,
          // active tabs, …) open the standalone confirmation modal so the user
          // can opt into a force-delete.
          if (!isForceableWorkspaceDeleteError(message)) {
            toast.error(`Could not delete workspace: ${message}`)
            return
          }
          const latest = ctx.getState()
          const project = latest.projects.find((entry) => entry.id === effect.projectId)
          const workspace = project?.workspaces?.find((entry) => entry.id === effect.workspaceId)
          ctx.dispatch({
            closeTabs: effect.closeTabs === true,
            force: true,
            projectId: effect.projectId,
            reason: message,
            type: 'open-workspace-delete-confirm',
            workspaceId: effect.workspaceId,
            workspaceLabel: workspace?.branch ?? workspace?.name ?? 'this workspace',
          })
        }
      })()
      return
    }
    case 'move-workspace': {
      void (async () => {
        try {
          await enqueueGitOp(async () =>
            runMoveWorkspace(
              { ...ctx, state: ctx.getState() },
              effect.projectId,
              effect.sourceWorkspaceId,
              effect.targetWorkspaceId,
              effect.deleteSource === true,
              effect.stashTarget === true,
              effect.keepConflicts === true
            )
          )
        } catch (error) {
          toast.error(error instanceof Error ? error.message : String(error))
        }
      })()
      return
    }
    case 'load-workspace-move-stats': {
      void (async () => {
        const project = state.projects.find((entry) => entry.id === state.currentProjectId)
        const workspaces = project?.workspaces ?? []
        if (workspaces.length === 0) return
        const counts = await Promise.all(
          workspaces.map(async (workspace) => [workspace.id, await countDirtyFiles(workspace.path)])
        )
        if (ctx.getState().modal.type !== 'workspace-move') return
        ctx.dispatch({
          dirtyFiles: Object.fromEntries(counts),
          type: 'set-workspace-move-stats',
        })
      })()
      return
    }
    case 'open-rename-selected-project': {
      openSelectedProjectRename(ctx)
      return
    }
    case 'create-project':
      handleCreateProjectEffect(state, dispatch, effect.name, effect.projectPath)
      return
    case 'close-tab': {
      ctx.clearIdleTimer(effect.tabId)
      ctx.clearStartupGrace(effect.tabId)
      backend.disposeSession(effect.tabId)
      return
    }
    case 'restart-tab':
      restartTabSession(
        backend,
        dispatch,
        ctx.clearIdleTimer,
        ctx.clearStartupGrace,
        (tab) => startExistingTab(ctx, tab),
        effect.tab
      )
      return
    case 'paste-selected-snippet': {
      pasteSnippetToTab(backend, state.activeTabId, ctx.activeTab, getSelectedSnippet(state))
      return
    }
    case 'paste-snippet-to-group': {
      pasteSnippetToActiveGroup(ctx)
      return
    }
    case 'edit-selected-snippet': {
      const snippet = getSelectedSnippet(state)
      if (snippet) {
        dispatch({ snippetId: snippet.id, type: 'open-snippet-editor' })
      }
      return
    }
    case 'delete-selected-snippet': {
      const snippet = getSelectedSnippet(state)
      if (snippet) {
        handleDeleteSnippetEffect(state.snippets, dispatch, snippet.id)
      }
      return
    }
    case 'save-snippet-editor': {
      handleSaveSnippetEditorEffect(state, dispatch)
      return
    }
    case 'save-custom-command': {
      saveCustomCommandSelection(ctx)
      return
    }
    case 'apply-theme': {
      applyThemeEffect(effect, ctx)
      return
    }
    case 'rename-project': {
      handleRenameProjectEffect(state.projects, dispatch, effect.projectId, effect.name)
      return
    }
    case 'rename-tab': {
      dispatch({
        autoRenameStatus: 'attempted',
        tabId: effect.tabId,
        title: effect.title,
        type: 'rename-tab',
      })
      backend.renameTab(effect.tabId, effect.title)
      return
    }
    case 'split-pane': {
      const sourceTab =
        effect.sourceTabId != null && effect.sourceTabId !== ''
          ? state.tabs.find((t) => t.id === effect.sourceTabId)
          : undefined
      const assistant = sourceTab?.assistant ?? 'terminal'
      const customCommand = state.customCommands[assistant]
      const tab = createTabSession(
        assistant,
        customCommand,
        state.customCommands,
        sourceTab?.workspaceId
      )
      executeSplitPane(ctx, effect.direction, tab)
      return
    }
    case 'confirm-split': {
      confirmSplitSelection(ctx)
      return
    }
    case 'scroll-git-diff': {
      scrollGitDiff(effect.delta)
      return
    }
    case 'persist-git-diff-mode-ratio': {
      const config = loadConfig()
      saveConfig({ ...config, gitPane: { ...config.gitPane, diffModeRatio: effect.ratio } })
      return
    }
    case 'persist-git-file-list-mode': {
      const config = loadConfig()
      saveConfig({ ...config, gitPane: { ...config.gitPane, fileListMode: effect.mode } })
      return
    }
    case 'persist-git-tree-compaction': {
      const config = loadConfig()
      saveConfig({ ...config, gitPane: { ...config.gitPane, treeCompaction: effect.enabled } })
      return
    }
    case 'git-stage': {
      void enqueueGitOp(async () => runGitAction(ctx, ['add', '--', effect.path], effect.path))
      return
    }
    case 'git-unstage': {
      void enqueueGitOp(async () =>
        runGitAction(ctx, ['restore', '--staged', '--', effect.path], effect.path)
      )
      return
    }
    case 'git-stage-all': {
      const paths = ctx.state.gitPanel.files.map((f) => f.path)
      void enqueueGitOp(async () => runGitActionAll(ctx, ['add', '-A'], paths))
      return
    }
    case 'git-unstage-all': {
      const paths = ctx.state.gitPanel.files.map((f) => f.path)
      void enqueueGitOp(async () => runGitActionAll(ctx, ['reset'], paths))
      return
    }
    case 'git-restore': {
      void enqueueGitOp(async () => runGitAction(ctx, ['restore', '--', effect.path], effect.path))
      return
    }
    case 'git-rm': {
      void enqueueGitOp(async () => runGitRm(ctx, effect.path))
      return
    }
    case 'git-commit': {
      const { body, title } = effect
      void enqueueGitOp(async () => runGitCommit(ctx, title, body))
      return
    }
    case 'git-commit-auto': {
      if (!isAutoCommitEnabled()) return
      const { body, title } = effect
      void enqueueGitOp(async () => runGitCommitAuto(ctx, title, body))
      return
    }
    case 'generate-auto-commit-now': {
      if (!isAutoCommitEnabled()) return
      void runGenerateAutoCommitNow(ctx, effect.projectId)
      return
    }
    case 'git-push': {
      void enqueueGitOp(async () => runGitPush(ctx))
      return
    }
    case 'confirm-update-selection': {
      handleConfirmUpdateSelection(ctx)
      return
    }
    case 'switch-project-by-index': {
      handleSwitchProjectByIndex(ctx, effect.index, effect.workspaceId)
      return
    }
    case 'cycle-sidebar-item': {
      handleCycleSidebarItem(ctx, effect.direction)
      return
    }
    case 'switch-tab-by-index': {
      handleSwitchTabByIndex(ctx, effect.index)
      return
    }
    case 'toggle-transparent': {
      const next = !getTransparent()
      setTransparent(next)
      saveConfig({ ...loadConfig(), themeTransparent: next })
      return
    }
    case 'toggle-mode': {
      const next = getCurrentMode() === 'dark' ? 'light' : 'dark'
      setMode(next)
      saveConfig({ ...loadConfig(), themeMode: next })
      return
    }
    case 'open-file-in-editor': {
      openFileInEditor(ctx, effect.path)
      return
    }
    case 'open-selected-snippet-source-in-editor': {
      openSelectedSnippetSourceInEditor(ctx)
      return
    }
    default:
      effect satisfies never
  }
}

/**
 * Open the file backing the currently selected snippet in the user's editor.
 * Config-pinned snippets (id starts with `config:`) live in `aimux.config.ts`
 * (or `.js`); user-edited snippets live in `aimux-snippets.json`.
 *
 * On error (no editor, editor not in PATH) the failure is silent: there is no
 * snippet-picker status line. The user can check the debug log.
 */
function openSelectedSnippetSourceInEditor(ctx: SideEffectContext): void {
  const snippet = getSelectedSnippet(ctx.state)
  if (!snippet) return

  const configDir = getProfileConfigDir()
  let absolutePath: string

  if (isConfigSnippetId(snippet.id)) {
    const tsPath = joinPath(configDir, 'aimux.config.ts')
    const jsPath = joinPath(configDir, 'aimux.config.js')
    absolutePath = existsSync(jsPath) && !existsSync(tsPath) ? jsPath : tsPath
  } else {
    absolutePath = getSnippetsCatalogPath()
  }

  launchEditorOnFile(ctx, absolutePath, configDir, (message) => {
    logInputDebug('snippets.openInEditor.error', { message, path: absolutePath })
    ctx.dispatch({ message, type: 'snippet-picker-set-message' })
  })
}

function openFileInEditor(ctx: SideEffectContext, relPath: string): void {
  const fileEntry = ctx.state.gitPanel.files.find((f) => f.path === relPath)
  const cwd = fileEntry?.repoPath ?? ctx.getCurrentProjectProjectPath()
  if (!(cwd != null && cwd !== '')) {
    ctx.dispatch({ message: 'no working directory', type: 'git-mode-set-message' })
    return
  }
  const absolutePath = resolvePath(cwd, relPath)
  launchEditorOnFile(ctx, absolutePath, cwd, (message) =>
    ctx.dispatch({ message, type: 'git-mode-set-message' })
  )
}

function launchEditorOnFile(
  ctx: SideEffectContext,
  absolutePath: string,
  cwd: string,
  onError: (message: string) => void
): void {
  const config = getExternalEditorConfig()
  const rawCommand = config.command ?? process.env.VISUAL ?? process.env.EDITOR
  if (rawCommand == null || rawCommand === '' || rawCommand.trim() === '') {
    onError('no $EDITOR/$VISUAL set — configure externalEditor in aimux.config.ts')
    return
  }

  const cmdParts = shellSplit(rawCommand)
  const executable = cmdParts[0]
  if (!(executable != null && executable !== '')) {
    onError('invalid editor command')
    return
  }
  const baseName = executable.split('/').pop() ?? executable
  const extraCmdArgs = cmdParts.slice(1)

  const kind: 'gui' | 'tui' = config.kind ?? (KNOWN_GUI_EDITORS.has(baseName) ? 'gui' : 'tui')

  const templateArgs = config.args ?? DEFAULT_EDITOR_ARGS[baseName] ?? ['{file}']
  // No line target — let substitution strip `{line}` placeholders so we don't
  // defeat the editor's "restore last cursor position" feature.
  const resolvedArgs = [...extraCmdArgs, ...substituteEditorArgs(templateArgs, absolutePath)]

  if (!isCommandAvailable(executable)) {
    onError(`editor not found in PATH: ${executable}`)
    return
  }

  if (kind === 'gui') {
    spawnDetached(ctx, [executable, ...resolvedArgs], cwd)
    return
  }

  if (config.terminal && config.terminal.length > 0) {
    const shellCmd = buildShellCmd(cwd, executable, resolvedArgs)
    const argv = config.terminal.map((a) =>
      a.replaceAll('{cmd}', shellCmd).replaceAll('{cwd}', cwd)
    )
    spawnDetached(ctx, argv, cwd)
    return
  }

  void openEditorInline(ctx, executable, resolvedArgs, cwd)
}

/**
 * Substitute `{file}` and `{line}` placeholders in an editor-arg template.
 *
 * When `line` is `undefined` we drop the line bits cleanly so we don't pass a
 * misleading `:1` / `+1` that would defeat the editor's "restore last cursor
 * position" feature:
 *   `['--line', '{line}', '{file}']` → `['{file}']`
 *   `['+{line}', '{file}']`          → `['{file}']`
 *   `['-g', '{file}:{line}']`        → `['-g', '{file}']`
 *   `['{file}:{line}']`              → `['{file}']`
 */
function substituteEditorArgs(template: string[], file: string, line?: string): string[] {
  if (line !== undefined) {
    return template.map((a) => a.replaceAll('{file}', file).replaceAll('{line}', line))
  }
  const out: string[] = []
  for (let i = 0; i < template.length; i++) {
    const arg = template[i] ?? ''
    // Drop a flag immediately followed by a bare `{line}` arg (--line, -line, etc.).
    if (template[i + 1] === '{line}') {
      i++
      continue
    }
    // Drop standalone line tokens like `{line}`, `+{line}`, `:{line}`.
    if (/^[+:]?\{line\}$/.test(arg)) continue
    // Strip trailing `:{line}` or `+{line}` from compound tokens like `{file}:{line}`.
    out.push(arg.replaceAll(/[:+]\{line\}/g, '').replaceAll('{file}', file))
  }
  return out
}

function shellQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`
}

/**
 * Minimal POSIX shell-word splitter — respects single/double quotes and
 * backslash escapes so values like `EDITOR='/Applications/My Editor/bin/code'`
 * or `EDITOR="code --user-data-dir \"/tmp/foo bar\""` tokenize correctly.
 * Does not expand variables or globs.
 */
function shellSplit(input: string): string[] {
  const out: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false
  let hasToken = false
  for (let i = 0; i < input.length; i++) {
    const c = input[i] ?? ''
    if (!inSingle && !inDouble && /\s/.test(c)) {
      if (hasToken) {
        out.push(current)
        current = ''
        hasToken = false
      }
      continue
    }
    hasToken = true
    if (c === "'" && !inDouble) {
      inSingle = !inSingle
    } else if (c === '"' && !inSingle) {
      inDouble = !inDouble
    } else if (c === '\\' && !inSingle && i + 1 < input.length) {
      current += input[++i]
    } else {
      current += c
    }
  }
  if (hasToken) out.push(current)
  return out
}

function buildShellCmd(cwd: string, executable: string, args: string[]): string {
  const quoted = [executable, ...args].map(shellQuote).join(' ')
  return `cd ${shellQuote(cwd)} && ${quoted}`
}

function spawnDetached(ctx: SideEffectContext, argv: string[], cwd?: string): void {
  try {
    const child = Bun.spawn(argv, {
      cwd,
      stderr: 'pipe',
      stdin: 'ignore',
      stdout: 'ignore',
    })
    void (async () => {
      const stderr = await new Response(child.stderr).text()
      const code = await child.exited
      if (code !== 0) {
        const firstStderrLine = stderr.trim().split('\n')[0]
        const firstLine =
          firstStderrLine != null && firstStderrLine !== '' ? firstStderrLine : `exit ${code}`
        ctx.dispatch({ message: `editor: ${firstLine}`, type: 'git-mode-set-message' })
      }
    })()
    child.unref()
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'failed to spawn'
    ctx.dispatch({ message: `editor: ${msg}`, type: 'git-mode-set-message' })
  }
}

/**
 * Suspend the opentui renderer, hand the TTY to the editor (inheriting
 * stdin/stdout/stderr), then resume and force a redraw on exit. Matches the
 * shellout pattern used by opencode (packages/opencode/src/cli/cmd/tui/util/editor.ts).
 */
async function openEditorInline(
  ctx: SideEffectContext,
  executable: string,
  args: string[],
  cwd: string
): Promise<void> {
  const { renderer } = ctx
  try {
    renderer.suspend()
    renderer.currentRenderBuffer.clear()
    const proc = Bun.spawn([executable, ...args], {
      cwd,
      stderr: 'inherit',
      stdin: 'inherit',
      stdout: 'inherit',
    })
    await proc.exited
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'failed to spawn editor'
    ctx.dispatch({ message: `editor: ${msg}`, type: 'git-mode-set-message' })
  } finally {
    renderer.currentRenderBuffer.clear()
    renderer.resume()
    renderer.requestRender()
  }
}

function handleSwitchProjectByIndex(
  ctx: SideEffectContext,
  index: number,
  workspaceId?: string
): void {
  const { backend, dispatch } = ctx
  // Read fresh state. ctx.state is the snapshot from the previous render and
  // lags behind dispatches that happened in the same JS turn.
  const state = ctx.getState()
  const ordered = [...state.projects].sort(
    (a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)
  )
  const target = ordered[index - 1]
  if (!target) {
    logInputDebug('app.projectBar.switchOutOfRange', { index, total: ordered.length })
    return
  }

  // Resolve which workspace to land on. If the caller passed an explicit
  // `workspaceId` (project-row tap → its primary, workspace-row tap → that
  // workspace), honor it; otherwise let the target project keep its persisted
  // activeWorkspaceId.
  const resolvedWorkspaceId =
    workspaceId != null &&
    workspaceId !== '' &&
    (target.workspaces?.some((w) => w.id === workspaceId) ?? false)
      ? workspaceId
      : undefined
  const needsWorkspaceChange =
    resolvedWorkspaceId != null && resolvedWorkspaceId !== target.activeWorkspaceId

  if (target.id === state.currentProjectId) {
    if (needsWorkspaceChange) {
      dispatch({
        projectId: target.id,
        type: 'set-active-workspace',
        workspaceId: resolvedWorkspaceId,
      })
    }
    if (state.focusMode === 'git') {
      dispatch({ type: 'exit-git-mode' })
    }
    return
  }

  // Cross-project: bundle the workspace change into the project record AND
  // fold set-projects + load-project into a SINGLE setState call. Otherwise
  // any subscriber notification (re-render, useEffect, backend re-attach)
  // between dispatches can re-assert the project's previously-persisted
  // activeWorkspaceId, dropping the user back on the last-visited workspace.
  const patchedProject = needsWorkspaceChange
    ? withActiveWorkspace(target, resolvedWorkspaceId)
    : target
  const patchedState: AppState = needsWorkspaceChange
    ? {
        ...state,
        projects: state.projects.map((s) => (s.id === patchedProject.id ? patchedProject : s)),
      }
    : state
  const projects = switchProjectRecords(patchedState, patchedProject)
  saveProjectCatalog(projects)
  void backend.destroy(true)
  appStore.setState((current) => {
    const afterSet = appReducer(current, { projects, type: 'set-projects' })
    return appReducer(afterSet, {
      forceDisconnected: false,
      projectId: patchedProject.id,
      projectSnapshot: patchedProject.projectSnapshot,
      type: 'load-project',
    })
  })
}

interface SidebarItem {
  projectId: string
  workspaceId: string | null
}

function buildSidebarItems(state: AppState): SidebarItem[] {
  const ordered = [...state.projects].sort(
    (a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)
  )
  const items: SidebarItem[] = []
  for (const project of ordered) {
    items.push({ projectId: project.id, workspaceId: null })
    const workspaces = project.workspaces ?? []
    const primary = getPrimaryWorkspace(workspaces)
    for (const wt of workspaces) {
      if (wt.id === primary?.id) continue
      items.push({ projectId: project.id, workspaceId: wt.id })
    }
  }
  return items
}

function findCurrentSidebarItem(state: AppState, items: SidebarItem[]): number {
  const projectId = state.currentProjectId
  if (projectId == null || projectId === '') return -1
  const project = state.projects.find((s) => s.id === projectId)
  const workspaces = project?.workspaces ?? []
  const primary = getPrimaryWorkspace(workspaces)
  const activeWtId = project?.activeWorkspaceId ?? null
  // The project row IS the primary workspace (no separate row), so an active
  // primary or undefined active maps to the project-item.
  const targetWorkspaceId = activeWtId == null || activeWtId === primary?.id ? null : activeWtId
  return items.findIndex(
    (item) => item.projectId === projectId && item.workspaceId === targetWorkspaceId
  )
}

function handleCycleSidebarItem(ctx: SideEffectContext, direction: 1 | -1): void {
  const { backend, dispatch } = ctx
  // Read fresh from the store, not ctx.state (which is a per-render
  // snapshot). Rapid key presses fire before React re-renders, so ctx.state
  // can lag the actual store.
  const state = appStore.getState()
  const items = buildSidebarItems(state)
  if (items.length === 0) return
  const currentIdx = findCurrentSidebarItem(state, items)
  // If we don't know the current, jump to first/last depending on direction.
  let startIdx: number
  if (currentIdx >= 0) {
    startIdx = currentIdx
  } else {
    startIdx = direction === 1 ? -1 : 0
  }
  const len = items.length
  const target = items[(((startIdx + direction) % len) + len) % len]
  if (!target) return

  const project = state.projects.find((s) => s.id === target.projectId)
  if (!project) return

  // Determine the workspace to activate. For project-items, that's the
  // primary; for workspace-items, the specific workspace.
  const workspaces = project.workspaces ?? []
  const primary = getPrimaryWorkspace(workspaces)
  const targetWorkspaceId = target.workspaceId ?? primary?.id

  const isCrossProject = project.id !== state.currentProjectId
  const needsWorkspaceChange =
    targetWorkspaceId != null && targetWorkspaceId !== project.activeWorkspaceId

  if (isCrossProject) {
    // Bundle the workspace change into the project record AND fold the
    // project switch's two dispatches (set-projects + load-project) into a
    // SINGLE Zustand setState call — otherwise each dispatch fires a
    // separate subscription notification and the @opentui/react reconciler
    // paints an intermediate frame where the new project is current but
    // the old activeWorkspaceId still holds, producing the visible flicker.
    const patchedProject = needsWorkspaceChange
      ? withActiveWorkspace(project, targetWorkspaceId)
      : project
    const patchedState: AppState = needsWorkspaceChange
      ? {
          ...state,
          projects: state.projects.map((s) => (s.id === patchedProject.id ? patchedProject : s)),
        }
      : state
    const projects = switchProjectRecords(patchedState, patchedProject)
    saveProjectCatalog(projects)
    void backend.destroy(true)
    appStore.setState((current) => {
      const afterSet = appReducer(current, { projects, type: 'set-projects' })
      return appReducer(afterSet, {
        // Daemon is alive and attach() will hydrate real statuses within a
        // frame, so skip the snapshot's running→disconnected downgrade —
        // otherwise the "Restored snapshot" hint flashes on every j/k cycle.
        forceDisconnected: false,
        projectId: patchedProject.id,
        projectSnapshot: patchedProject.projectSnapshot,
        type: 'load-project',
      })
    })
    return
  }

  if (needsWorkspaceChange) {
    dispatch({
      projectId: project.id,
      type: 'set-active-workspace',
      workspaceId: targetWorkspaceId,
    })
  }
}

function handleSwitchTabByIndex(ctx: SideEffectContext, index: number): void {
  const { dispatch, state } = ctx
  const currentProject =
    state.currentProjectId != null && state.currentProjectId !== ''
      ? state.projects.find((s) => s.id === state.currentProjectId)
      : undefined
  const visible = filterTabsForActiveWorkspace(state.tabs, currentProject)
  const entries = buildTabEntries(visible, state.layoutTrees, state.tabGroupMap, state.activeTabId)
  const target = entries[index - 1]
  if (!target) {
    logInputDebug('app.tabBar.switchOutOfRange', { index, total: entries.length })
    return
  }
  const targetTabId = target.kind === 'single' ? target.tab.id : target.activeLeafId
  if (targetTabId === state.activeTabId) return
  dispatch({ tabId: targetTabId, type: 'set-active-tab' })
}

/**
 * Rewrite one project and hand back the whole list, ready for `set-projects`.
 *
 * Reads the *live* store rather than `ctx.state`: callers reach here after
 * seconds of git work, and `ctx.state` is the render snapshot from before it.
 * Since `set-projects` replaces the array wholesale, a stale read does not just
 * miss an update — it reverts it. Workspace naming lands asynchronously, so
 * that window is wide open.
 */
function replaceProject(
  ctx: SideEffectContext,
  projectId: string,
  next: (project: AppState['projects'][number]) => AppState['projects'][number]
): AppState['projects'] {
  return ctx
    .getState()
    .projects.map((project) => (project.id === projectId ? next(project) : project))
}

function handleSwitchWorkspace(
  ctx: SideEffectContext,
  projectId: string,
  workspaceId: string
): void {
  const project = ctx.state.projects.find((entry) => entry.id === projectId)
  const workspace = project?.workspaces?.find((entry) => entry.id === workspaceId)
  if (!project || !workspace) return
  const projects = replaceProject(ctx, projectId, (entry) => ({
    ...entry,
    activeWorkspaceId: workspaceId,
    updatedAt: new Date().toISOString(),
  }))
  saveProjectCatalog(projects)
  ctx.dispatch({ projects, type: 'set-projects' })
}

function normalizeBranchName(branch: string | undefined): string | undefined {
  return branch?.replace(/^refs\/heads\//, '').trim()
}

async function createAimuxTempWorkspace(
  ctx: SideEffectContext,
  projectId: string,
  requestedName?: string,
  requestedBranchName?: string,
  requestedBaseRef?: string,
  sourceWorkspaceId?: string
): Promise<WorkspaceRecord | undefined> {
  const project = ctx.state.projects.find((entry) => entry.id === projectId)
  const source =
    project?.workspaces?.find((entry) => entry.id === sourceWorkspaceId) ??
    getActiveWorkspace(project)
  const sourcePath = source?.path ?? getActiveWorkspacePath(project)
  if (!project || !(sourcePath != null && sourcePath !== '')) return undefined

  // Resolve the *main* repo checkout, never the active linked workspace, so the
  // record's repoRoot stays valid after sibling workspaces are deleted.
  const repoRoot = (await getMainWorktreeRoot(sourcePath)) ?? source?.repoRoot ?? sourcePath
  const baseBranch = (await getCurrentBranch(sourcePath)) ?? source?.branch ?? 'HEAD'
  const baseRef = requestedBaseRef ?? baseBranch
  const workspaceId = createPrefixedId('workspace')
  const trimmedName = requestedName?.trim()
  const workspaceName =
    trimmedName != null && trimmedName !== ''
      ? trimmedName
      : `wt-${sanitizePathSegment(project.name, 12)}`
  const trimmedBranch = requestedBranchName?.trim()
  const branchName =
    trimmedBranch != null && trimmedBranch !== ''
      ? trimmedBranch
      : `aimux/${sanitizePathSegment(workspaceName, 40)}-${Date.now().toString(36)}`
  const targetPath = makeWorktreePath({ repoRoot, workspaceId, workspaceName })

  const existingWorkspace = (await listGitWorktrees(repoRoot)).find(
    (entry) =>
      entry.prunable !== true &&
      normalizeBranchName(entry.branch) === normalizeBranchName(branchName)
  )
  if (existingWorkspace) {
    ctx.dispatch({
      message: `Branch already checked out in another workspace: ${existingWorkspace.path}`,
      type: 'set-create-workspace-branch-error',
    })
    return undefined
  }

  await mkdir(dirname(targetPath), { recursive: true })
  await assertSafeAimuxWorktreePath(targetPath)
  await createGitWorktree({ baseRef, branchName, repoPath: repoRoot, targetPath })
  const now = new Date().toISOString()

  const workspace: WorkspaceRecord = {
    baseRef,
    branch: branchName,
    commitSha: await getHeadSha(targetPath),
    createdAt: now,
    createdByAimux: true,
    id: workspaceId,
    name: workspaceName,
    path: targetPath,
    repoRoot,
    source: 'aimux-temp',
    updatedAt: now,
  }
  const projects = replaceProject(ctx, projectId, (entry) => ({
    ...entry,
    activeWorkspaceId: workspace.id,
    updatedAt: now,
    workspaces: [...(entry.workspaces ?? []), workspace],
  }))
  saveProjectCatalog(projects)
  ctx.dispatch({ projects, type: 'set-projects' })
  toast.success(`Created workspace ${branchName}`)
  return workspace
}

// Dispose and close every tab pinned to a workspace (timers, pty project, state).
function disposeWorkspaceTabs(ctx: SideEffectContext, workspaceId: string): void {
  for (const tab of ctx.state.tabs.filter((entry) => entry.workspaceId === workspaceId)) {
    ctx.clearIdleTimer(tab.id)
    ctx.clearStartupGrace(tab.id)
    ctx.backend.disposeSession(tab.id)
    ctx.dispatch({ tabId: tab.id, type: 'close-tab' })
  }
}

async function runDeleteWorkspace(
  ctx: SideEffectContext,
  projectId: string,
  workspaceId: string,
  force: boolean,
  closeTabs = false
): Promise<void> {
  const project = ctx.state.projects.find((entry) => entry.id === projectId)
  const workspace = project?.workspaces?.find((entry) => entry.id === workspaceId)
  if (!project) throw new Error('project not found')
  if (!workspace) throw new Error('workspace not found')
  if ((project.workspaces?.length ?? 0) <= 1) throw new Error('at least one workspace must remain')
  if (workspace.source === 'primary') throw new Error('root workspace cannot be deleted')

  const tabsInWorkspace = ctx.state.tabs.filter((tab) => tab.workspaceId === workspaceId)
  // The active-tabs guard asks the modal user to confirm before closing tabs.
  // `closeTabs` (the sidebar's "Remove workspace") opts into closing them
  // directly without forcing the git removal, so dirty temp workspaces are still
  // protected by the non-force `git worktree remove`.
  if (tabsInWorkspace.length > 0 && !force && !closeTabs) {
    throw new ActiveWorkspaceTabsError(tabsInWorkspace.length)
  }

  const repoPath = resolveWorkspaceGitDir(project, workspace)
  const isAimuxTemp = workspace.source === 'aimux-temp' && workspace.createdByAimux
  // Drop the throwaway aimux branch alongside the workspace so deleted temp
  // workspaces don't accumulate in the repo or haunt the base picker. Scoped to
  // the `aimux/` namespace (matches the picker filter); best-effort.
  const cleanupAimuxBranch = async (): Promise<void> => {
    const branch = workspace.branch
    if (isAimuxTemp && branch != null && branch !== '' && branch.startsWith('aimux/')) {
      await deleteGitBranch(repoPath, branch)
    }
  }

  // Run git ops FIRST. If any throws (dirty workspace, etc.) the catch in the
  // delete-workspace side effect handler re-prompts force or toasts the error —
  // tabs stay open and the row stays in the sidebar, so the UI matches reality
  // instead of leaving tabs closed against a workspace that still exists.
  if (isAimuxTemp && isInsideAimuxWorktreeRoot(workspace.path) && !existsSync(workspace.path)) {
    // The dir vanished but git may still pin the branch to a stale workspace entry.
    await pruneGitWorktrees(repoPath)
  } else if (isAimuxTemp && isInsideAimuxWorktreeRoot(workspace.path)) {
    await assertSafeAimuxWorktreePath(workspace.path)
    await removeGitWorktree({ force, repoPath, targetPath: workspace.path })
  } else if (workspace.source === 'aimux-temp' || workspace.createdByAimux) {
    throw new Error(`refusing unsafe workspace delete: ${workspace.path}`)
  }

  await cleanupAimuxBranch()

  // Only after git success: close tabs + retire the record. Re-read state so
  // we don't operate on the snapshot captured before the awaits above.
  disposeWorkspaceTabs({ ...ctx, state: ctx.getState() }, workspaceId)
  const latest = ctx.getState()
  const latestProject = latest.projects.find((entry) => entry.id === projectId)
  if (latestProject) {
    removeWorkspaceRecordFromProject(
      { ...ctx, state: latest },
      projectId,
      latestProject,
      workspaceId
    )
  }
}

// A workspace's stored repoRoot can point at a sibling workspace that was since
// deleted. Git commands only need *some* existing workspace of the repo (they
// share the common git dir), so fall back to the main checkout or any live
// workspace path rather than letting `git -C` fail on a vanished directory.
function resolveWorkspaceGitDir(
  project: NonNullable<SideEffectContext['state']['projects'][number]>,
  workspace: WorkspaceRecord
): string {
  const candidates = [
    project.workspaces?.find((entry) => entry.source === 'primary')?.path,
    workspace.repoRoot,
    ...(project.workspaces ?? [])
      .filter((entry) => entry.id !== workspace.id)
      .map((entry) => entry.path),
  ]
  return candidates.find((path) => path !== undefined && existsSync(path)) ?? workspace.repoRoot
}

async function runMoveWorkspace(
  ctx: SideEffectContext,
  projectId: string,
  sourceWorkspaceId: string,
  targetWorkspaceId: string,
  deleteSource: boolean,
  stashTarget: boolean,
  keepConflicts: boolean
): Promise<void> {
  const project = ctx.state.projects.find((entry) => entry.id === projectId)
  const source = project?.workspaces?.find((entry) => entry.id === sourceWorkspaceId)
  const target = project?.workspaces?.find((entry) => entry.id === targetWorkspaceId)
  if (!project) throw new Error('project not found')
  if (!source || !target) throw new Error('workspace not found')
  if (source.id === target.id) throw new Error('source and target are the same workspace')
  if (source.branch == null || source.branch === '') {
    throw new Error('source workspace has no branch to move')
  }
  if (deleteSource && source.source === 'primary') {
    throw new Error('the primary workspace cannot be deleted')
  }

  const sourceLabel = source.branch ?? source.name
  const targetLabel = target.branch ?? target.name
  const result = await moveWorkspace({
    keepConflicts,
    sourceBranch: source.branch,
    sourcePath: source.path,
    stashTarget,
    targetPath: target.path,
  })

  // Recoverable failures open a confirm dialog carrying retry params; both
  // workspaces are already back in their original state, so confirming simply
  // re-dispatches move-workspace with the matching flag.
  if (result.kind === 'needs-stash' || result.kind === 'conflict') {
    ctx.dispatch({
      deleteSource,
      files: result.files,
      projectId,
      sourceLabel,
      sourceWorkspaceId,
      targetLabel,
      targetWorkspaceId,
      type: 'open-workspace-move-confirm',
      variant: result.kind === 'needs-stash' ? 'stash-target' : 'keep-conflicts',
    })
    return
  }
  if (result.kind === 'conflict-kept') {
    // Never delete the source here — its work only landed half-resolved. The
    // auto-commit driver is safe against this state: git refuses to commit
    // with unmerged index entries, so it fails loudly instead of committing
    // conflict markers.
    handleSwitchWorkspace({ ...ctx, state: ctx.getState() }, projectId, targetWorkspaceId)
    toast.warning(
      `Left conflict markers in ${targetLabel} (${result.files.length} file(s)) — resolve & commit there; ${sourceLabel} kept`
    )
    return
  }
  if (result.kind === 'error') {
    toast.error(`Move failed: ${result.message}`)
    return
  }

  // Land on the target. When deleting the source, close its terminals and
  // switch to the target up front, synchronously, BEFORE the slow
  // `git worktree remove`. Closing the source's active tab re-syncs the active
  // workspace to a default tab (withActiveTabWorkspace); doing the close+switch in
  // one batch lands on the target with no intermediate render, so the removal
  // runs with the target already active instead of flashing/sticking to a
  // default workspace. Re-read state each step so we never resurrect the source.
  if (deleteSource) {
    disposeWorkspaceTabs({ ...ctx, state: ctx.getState() }, sourceWorkspaceId)
    handleSwitchWorkspace({ ...ctx, state: ctx.getState() }, projectId, targetWorkspaceId)
    await runDeleteWorkspace({ ...ctx, state: ctx.getState() }, projectId, sourceWorkspaceId, true)
  } else {
    handleSwitchWorkspace({ ...ctx, state: ctx.getState() }, projectId, targetWorkspaceId)
  }
  const stashNote = result.stashedTarget
    ? ` · target's previous changes stashed (recover with git stash pop)`
    : ''
  toast.success(
    `Moved ${sourceLabel} → ${targetLabel} · ${result.filesChanged} file(s) staged — review & commit${stashNote}`
  )
}

function removeWorkspaceRecordFromProject(
  ctx: SideEffectContext,
  projectId: string,
  project: NonNullable<SideEffectContext['state']['projects'][number]>,
  workspaceId: string
): void {
  const projects = replaceProject(ctx, projectId, (entry) => {
    // Filtered from `entry`, not from the `project` this was called with: a
    // workspace created while the delete's git work ran is in one and not the
    // other, and rebuilding from the stale copy would delete it too.
    const remaining = (entry.workspaces ?? []).filter((w) => w.id !== workspaceId)
    return {
      ...entry,
      activeWorkspaceId: (entry.activeWorkspaceId === workspaceId
        ? remaining[0]
        : getActiveWorkspace(entry)
      )?.id,
      projectSnapshot: pruneSnapshotOfWorkspace(entry.projectSnapshot, workspaceId),
      updatedAt: new Date().toISOString(),
      workspaces: remaining,
    }
  })
  saveProjectCatalog(projects)
  ctx.dispatch({ projects, type: 'set-projects' })
}

function isForceableWorkspaceDeleteError(message: string): boolean {
  return /active assistant tabs|dirty|uncommitted|modified|untracked|not clean|contains.*changes/i.test(
    message
  )
}

class ActiveWorkspaceTabsError extends Error {
  constructor(tabCount: number) {
    super(
      `active assistant tabs are using this workspace (${tabCount}) — they will be closed if you confirm.`
    )
  }
}

function handleConfirmUpdateSelection(ctx: SideEffectContext): void {
  const { state } = ctx
  if (state.modal.type !== 'update-available') {
    return
  }
  const latest = state.modal.latestVersion
  if (state.modal.selectedIndex === 0) {
    runUpdateFromTui(ctx, latest)
    return
  }
  saveConfig({ ...loadConfig(), skippedUpdateVersion: latest })
}

function runUpdateFromTui(ctx: SideEffectContext, latestVersion: string): void {
  saveCurrentProject(ctx.state)
  void ctx.backend.destroy(true)
  ctx.renderer.destroy()
  process.stdout.write(`\nUpdating aimux to ${latestVersion}...\n`)
  const proc = Bun.spawn(['bun', 'update', '-g', '@brimveyn/aimux', '@brimveyn/aimux-config'], {
    stderr: 'inherit',
    stdin: 'inherit',
    stdout: 'inherit',
  })
  void (async () => {
    const code = await proc.exited
    if (code === 0) {
      process.stdout.write(`\nUpdated. Run \`aimux\` to start the new version.\n`)
    } else {
      process.stderr.write(`\nUpdate failed (exit code ${code}).\n`)
    }
    process.exit(code ?? 1)
  })()
}

async function runGitAction(
  ctx: SideEffectContext,
  args: string[],
  pathToInvalidate?: string
): Promise<void> {
  const fallback = ctx.getCurrentProjectProjectPath()
  const repoPath =
    pathToInvalidate != null && pathToInvalidate !== ''
      ? ctx.state.gitPanel.files.find((f) => f.path === pathToInvalidate)?.repoPath
      : undefined
  const cwd = repoPath ?? fallback
  if (!(cwd != null && cwd !== '')) return
  const result = await $`git -C ${cwd} ${args}`.quiet().nothrow()
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim()
    ctx.dispatch({ message: stderr || 'git action failed', type: 'git-mode-set-message' })
    return
  }
  ctx.dispatch({ message: null, type: 'git-mode-set-message' })
  if (pathToInvalidate != null && pathToInvalidate !== '') {
    ctx.dispatch({ path: pathToInvalidate, type: 'git-mode-clear-diff-cache' })
  }
}

async function runGitActionAll(
  ctx: SideEffectContext,
  args: string[],
  pathsToInvalidate: string[]
): Promise<void> {
  const cwd = ctx.getCurrentProjectProjectPath()
  if (!(cwd != null && cwd !== '')) return
  const result = await $`git -C ${cwd} ${args}`.quiet().nothrow()
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim()
    ctx.dispatch({ message: stderr || 'git action failed', type: 'git-mode-set-message' })
    return
  }
  ctx.dispatch({ message: null, type: 'git-mode-set-message' })
  if (pathsToInvalidate.length > 0) {
    ctx.dispatch({ paths: pathsToInvalidate, type: 'git-mode-invalidate-diffs' })
  }
}

async function runGitRm(ctx: SideEffectContext, path: string): Promise<void> {
  const repoPath = ctx.state.gitPanel.files.find((f) => f.path === path)?.repoPath
  const cwd = repoPath ?? ctx.getCurrentProjectProjectPath()
  if (!(cwd != null && cwd !== '')) return
  const absolute = `${cwd}/${path}`
  try {
    const stat = await Bun.file(absolute).stat()
    await (stat.isDirectory()
      ? Bun.$`rm -rf -- ${absolute}`.quiet().nothrow()
      : Bun.file(absolute).unlink())
  } catch (error) {
    const message = error instanceof Error ? error.message : 'failed to delete file'
    ctx.dispatch({ message, type: 'git-mode-set-message' })
    return
  }
  ctx.dispatch({ message: null, type: 'git-mode-set-message' })
  ctx.dispatch({ path, type: 'git-mode-clear-diff-cache' })
}

async function runGitCommit(ctx: SideEffectContext, title: string, body: string): Promise<void> {
  const cwd = ctx.getCurrentProjectProjectPath()
  if (!(cwd != null && cwd !== '')) return
  if (!title) {
    ctx.dispatch({ message: 'empty commit title', type: 'git-mode-set-message' })
    return
  }
  const result = body
    ? await $`git -C ${cwd} commit -m ${title} -m ${body}`.quiet().nothrow()
    : await $`git -C ${cwd} commit -m ${title}`.quiet().nothrow()
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim()
    ctx.dispatch({ message: null, type: 'git-mode-set-message' })
    toast.error(stderr || 'Commit failed')
    return
  }
  clearAutoCommitForCurrentProject(ctx)
  // Match the push flow: clear any inline git-pane message and surface the
  // result as a toast so it's seen even after leaving git mode.
  ctx.dispatch({ message: null, type: 'git-mode-set-message' })
  toast.success(`Committed: ${title}`)
}

async function runGitCommitAuto(
  ctx: SideEffectContext,
  title: string,
  body: string
): Promise<void> {
  if (!title) {
    ctx.dispatch({ message: 'empty commit title', type: 'git-mode-set-message' })
    return
  }
  const cwd = ctx.getCurrentProjectProjectPath()
  if (!(cwd != null && cwd !== '')) return

  // If the user has manually staged files, respect that intent and commit
  // only the staged set — don't run `git add -A` which would sweep up
  // unrelated unstaged/untracked changes. With nothing staged, `add -A`
  // keeps the "commit everything" behaviour the user expects from auto-commit.
  const hasStaged = ctx.state.gitPanel.files.some((f) => f.section === 'staged')
  if (!hasStaged) {
    const addArgs = ['add', '-A']
    const addResult = await $`git -C ${cwd} ${addArgs}`.quiet().nothrow()
    if (addResult.exitCode !== 0) {
      ctx.dispatch({ message: null, type: 'git-mode-set-message' })
      toast.error(addResult.stderr.toString().trim() || 'Auto-commit: git add failed')
      return
    }
  }

  const commitResult = body
    ? await $`git -C ${cwd} commit -m ${title} -m ${body}`.quiet().nothrow()
    : await $`git -C ${cwd} commit -m ${title}`.quiet().nothrow()

  if (commitResult.exitCode !== 0) {
    ctx.dispatch({ message: null, type: 'git-mode-set-message' })
    toast.error(commitResult.stderr.toString().trim() || 'Auto-commit: commit failed')
    return
  }

  clearAutoCommitForCurrentProject(ctx)
  ctx.dispatch({ message: `committed: ${title}`, type: 'git-mode-set-message' })
}

function clearAutoCommitForCurrentProject(ctx: SideEffectContext): void {
  const projectId = ctx.state.currentProjectId
  if (!(projectId != null && projectId !== '')) return
  ctx.dispatch({ projectId, type: 'auto-commit-clear' })
}

async function runGenerateAutoCommitNow(ctx: SideEffectContext, projectId: string): Promise<void> {
  const project = ctx.state.projects.find((s) => s.id === projectId)
  const panel = ctx.state.gitPanel
  if (panel.error !== null) {
    toast.warning('Auto-commit: git panel unavailable')
    ctx.dispatch({ projectId, type: 'auto-commit-clear' })
    return
  }
  const tab = ctx.activeTab
  if (!tab) {
    toast.warning('Auto-commit: no active assistant tab — open a claude/codex tab first')
    ctx.dispatch({ projectId, type: 'auto-commit-clear' })
    return
  }
  await triggerAutoCommitNow({
    assistant: tab.assistant,
    git: {
      ahead: panel.ahead,
      behind: panel.behind,
      branch: panel.branch,
      files: panel.files,
    },
    projectId,
    projectPath: project?.projectPath,
    tabId: tab.id,
  })
}

async function runGitPush(ctx: SideEffectContext): Promise<void> {
  const cwd = ctx.getCurrentProjectProjectPath()
  if (!(cwd != null && cwd !== '')) return
  ctx.dispatch({ message: 'pushing…', type: 'git-mode-set-message' })

  const upstream = await $`git -C ${cwd} rev-parse --abbrev-ref --symbolic-full-name @{u}`
    .quiet()
    .nothrow()
  const hasUpstream = upstream.exitCode === 0

  const result = hasUpstream
    ? await $`git -C ${cwd} push`.quiet().nothrow()
    : await $`git -C ${cwd} push --set-upstream origin HEAD`.quiet().nothrow()

  // Clear the inline "pushing…" progress; surface the result as a toast so it's
  // visible even after leaving git mode (and so push failures aren't missed).
  ctx.dispatch({ message: null, type: 'git-mode-set-message' })
  if (result.exitCode !== 0) {
    toast.error(result.stderr.toString().trim() || 'Push failed')
    return
  }
  toast.success('Pushed')
}

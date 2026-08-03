import { isAutoCommitEnabled } from '@brimveyn/aimux-config'

import type { SideEffect } from '../input/modes/types'
import type { AssistantId, PendingWorkspaceLaunch, WorkspaceRecord } from '../state/types'
import type { SideEffectContext } from './side-effect-context'

import { loadConfig, saveConfig } from '../config'
import { logInputDebug } from '../debug/input-log'
import { enqueueGitOp } from '../git/command-queue'
import { countDirtyFiles } from '../git/move-workspace'
import { getCurrentBranch, getDefaultBranch, listLocalBranches } from '../git/worktree'
import { createPrefixedId } from '../platform/id'
import { assistantAcceptsPromptArg } from '../pty/command-registry'
import { allLeafIds, getGroupIdForTab } from '../state/layout-tree'
import { hasSetupScript } from '../state/project-data'
import { saveCurrentProject } from '../state/project-save'
import { getActiveWorkspace, getActiveWorkspacePath } from '../state/project-workspaces'
import { toast } from '../state/toast-store'
import { filterThemeIds } from '../ui/filter-themes'
import { scrollGitDiff } from '../ui/git-view-controls'
import { applyTheme, getCurrentMode, getTransparent, setMode, setTransparent } from '../ui/theme'
import { openFileInEditor, openSelectedSnippetSourceInEditor } from './editor-actions'
import {
  runGenerateAutoCommitNow,
  runGitAction,
  runGitActionAll,
  runGitCommit,
  runGitCommitAuto,
  runGitPush,
  runGitRm,
} from './git-actions'
import {
  handleCycleSidebarItem,
  handleSwitchProjectByIndex,
  handleSwitchTabByIndex,
} from './navigation-actions'
import {
  handleCreateProjectEffect,
  handleDeleteProjectEffect,
  handleRenameProjectEffect,
  handleSwitchProjectEffect,
  restartTabSession,
} from './project-actions'
import { injectPromptWhenReady } from './prompt-injection'
import { getSelectedAssistantOption, getSelectedProject, getSelectedSnippet } from './selection'
import {
  changeSelectedSetting,
  commitSettingText,
  confirmSettingsSearch,
  resetSelectedSetting,
} from './settings-actions'
import {
  findSetupTab,
  handleAskAgentForSetupScriptEffect,
  handleConfigureSetupScriptEffect,
  handlePromoteSetupTabEffect,
  handleRunSetupEffect,
  handleStopSetupEffect,
} from './setup-actions'
import {
  handleDeleteSnippetEffect,
  handleSaveSnippetEditorEffect,
  pasteSnippetToTab,
} from './snippet-actions'
import {
  confirmSplitSelection,
  createTabSession,
  executeSplitPane,
  launchAssistant,
  startExistingTab,
} from './tab-actions'
import {
  createAimuxTempWorkspace,
  isForceableWorkspaceDeleteError,
  runDeleteWorkspace,
  runMoveWorkspace,
  setProjectDefaultBaseRef,
} from './workspace-actions'
import { placeholderWorkspaceName, renameWorkspaceFromPrompt } from './workspace-naming'

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

/** The given branch first, the rest in the order they came. */
function hoistBranch(branches: string[], first: string | undefined): string[] {
  if (first == null || !branches.includes(first)) return branches
  return [first, ...branches.filter((branch) => branch !== first)]
}

/**
 * Setup runs concurrently with the agent by design, so say so rather than
 * letting the agent run tests against a half-installed tree and draw the wrong
 * conclusion. Only prefixed when a setup is actually live.
 */
function buildWorkspacePrompt(ctx: SideEffectContext, pending: PendingWorkspaceLaunch): string {
  const setupTab = findSetupTab(ctx.getState().tabs, pending.workspaceId)
  // No setup tab yet does not mean no setup: the workspace may have landed in
  // the store this very tick, and the runner only spawns on the next render. A
  // project with a script is going to run it, so say so.
  const setupRunning = setupTab ? setupTab.status === 'running' : hasSetupScript(pending.projectId)
  if (!setupRunning) return pending.prompt
  return `Note: a setup script is currently installing this workspace's dependencies in the background. Wait for it to finish before running builds, tests, or anything that reads installed dependencies.\n\n${pending.prompt}`
}

/**
 * Name the workspace after what its prompt describes, using the assistant the
 * user just picked. Background work that must never block or fail the launch.
 *
 * Always `pending.prompt`, never the setup-annotated variant built for the
 * agent — the note is guidance, not part of what the user asked for.
 */
function renameWorkspaceFromLaunch(
  ctx: SideEffectContext,
  pending: PendingWorkspaceLaunch,
  assistant: AssistantId
): void {
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
 * The `<C-p>` worktree being cut while its assistant picker is already open.
 * Single-slot: only one create-workspace modal can be open, so only one chain
 * can ever be in flight.
 */
let pendingWorkspaceCreate: Promise<WorkspaceRecord | undefined> | null = null

/**
 * The `<C-p>` flow: chain into the new-tab modal *now* and cut the worktree in
 * the background. `git fetch` + `worktree add` take seconds, and the next
 * question — which assistant — does not depend on either, so making the user
 * watch a frozen modal buys nothing. `launch-selected-assistant` waits on
 * `pendingWorkspaceCreate`, so the tab still lands in a finished workspace.
 */
function startWorkspaceCreation(
  ctx: SideEffectContext,
  projectId: string,
  params: {
    prompt: string
    baseRef?: string
  }
): void {
  // Allocated here rather than by the create: the picker below pins its tab to
  // this workspace before git has produced anything to pin to.
  const workspaceId = createPrefixedId('workspace')
  pendingWorkspaceCreate = (async () => {
    try {
      return await enqueueGitOp(async () =>
        // A name derived locally from the prompt, so the sidebar reads right from
        // the first frame. The model-generated one replaces it a few seconds later.
        // The branch is left to `createAimuxTempWorkspace`, which suffixes it with
        // a timestamp: two workspaces started from the same prompt must not
        // collide on the branch name before the model has distinguished them.
        createAimuxTempWorkspace(ctx, projectId, {
          baseRef: params.baseRef,
          name: placeholderWorkspaceName(params.prompt),
          workspaceId,
        })
      )
    } catch (error) {
      // The modal that used to show this is already gone, so the toast is the
      // only channel left — and the launch reads the undefined as "do not spawn".
      toast.error(error instanceof Error ? error.message : String(error))
      return
    }
  })()
  ctx.dispatch({ type: 'close-modal' })
  ctx.dispatch({
    pendingWorkspace: { projectId, prompt: params.prompt, workspaceId },
    type: 'open-new-tab-modal',
  })
}

/**
 * Spawn the assistant and get `prompt` in front of it.
 *
 * Handed over at spawn where the CLI takes one. Pasting it into a live TUI
 * works — it is what this flow did — but it means polling for readiness,
 * probing the screen, and retrying. An argv slot has none of those failure
 * modes.
 */
function launchWithPrompt(
  ctx: SideEffectContext,
  assistant: AssistantId,
  prompt: string,
  workspaceId: string | undefined
): void {
  const atSpawn = prompt !== '' && assistantAcceptsPromptArg(assistant, ctx.state.customCommands)
  logInputDebug('app.launchSelectedAssistant', {
    assistant,
    chained: workspaceId != null,
    promptAtSpawn: atSpawn,
    promptLength: prompt.length,
  })

  const tabId = launchAssistant(ctx, assistant, workspaceId, atSpawn ? [prompt] : undefined)
  // Delivery is decided and done here, chained or not: two call sites meant the
  // prompt could be built twice, from two different reads of the store.
  if (prompt !== '' && !atSpawn) {
    void injectPromptWhenReady({
      backend: ctx.backend,
      getState: ctx.getState,
      prompt,
      tabId,
    })
  }
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
      // A tab opens wherever the project currently sits, the repo checkout
      // included: a worktree is not free — it starts without `.env`,
      // `node_modules` or anything else untracked — so plenty of repos never
      // want one. `<C-p>` remains the short path to an isolated branch; it is
      // an offer, not a toll gate.
      if (!state.projects.some((entry) => entry.id === state.currentProjectId)) {
        toast.error('Open a project first — <C-g>')
        return
      }
      dispatch({ type: 'open-new-tab-modal' })
      return
    }
    case 'launch-selected-assistant': {
      const assistant = getSelectedAssistantOption(state).id
      // Chained from `<C-p>`: pin the tab to the workspace being created, hand it
      // the prompt, and name the workspace with the assistant the user picked.
      // Otherwise the tab lands in the project's active workspace, which
      // launchAssistant resolves itself.
      const pending = state.modal.type === 'new-tab' ? state.modal.pendingWorkspace : undefined
      if (!pending) {
        // Normalized to '' so "is there a prompt" stays one comparison.
        const pendingPrompt = state.modal.type === 'new-tab' ? state.modal.pendingPrompt : undefined
        launchWithPrompt(ctx, assistant, pendingPrompt ?? '', undefined)
        return
      }
      const creating = pendingWorkspaceCreate
      pendingWorkspaceCreate = null
      void (async () => {
        // The worktree may still be being cut. Spawning first would drop the tab
        // in the project checkout instead of the workspace it is pinned to.
        if (creating && !(await creating)) {
          toast.error('Workspace creation failed — no tab was opened')
          return
        }
        // Read the store again: the workspace record landed after `ctx.state`
        // was captured, and `getTabProjectPath` resolves the cwd from it.
        const fresh = { ...ctx, state: ctx.getState() }
        launchWithPrompt(
          fresh,
          assistant,
          buildWorkspacePrompt(fresh, pending),
          pending.workspaceId
        )
        renameWorkspaceFromLaunch(fresh, pending, assistant)
      })()
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
        const [branches, defaultBranch, currentBranch] = await Promise.all([
          listLocalBranches(sourcePath),
          getDefaultBranch(sourcePath),
          getCurrentBranch(sourcePath),
        ])
        if (ctx.getState().modal.type !== 'create-workspace') return
        ctx.dispatch({
          // Stacking on the branch you are already on is the other common base,
          // and committer date buries it once anyone else pushes.
          branches: hoistBranch(branches, currentBranch),
          // The project's convention wins over what the repo declares: a gitflow
          // repo still says `main` while everyone branches off `develop`.
          defaultBranch: project?.defaultBaseRef ?? defaultBranch,
          type: 'set-create-workspace-base-branches',
        })
      })()
      return
    }
    case 'create-workspace': {
      if (state.modal.type !== 'create-workspace') return
      const projectId = state.currentProjectId
      if (!(projectId != null && projectId !== '')) return
      const { baseRef, prompt } = state.modal
      startWorkspaceCreation(ctx, projectId, {
        baseRef: baseRef !== '' ? baseRef : undefined,
        prompt,
      })
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
    case 'run-setup': {
      handleRunSetupEffect(ctx)
      return
    }
    case 'stop-setup': {
      handleStopSetupEffect(ctx)
      return
    }
    case 'configure-setup-script': {
      handleConfigureSetupScriptEffect(ctx, effect.projectId)
      return
    }
    case 'set-project-default-base-ref': {
      setProjectDefaultBaseRef(ctx, effect.projectId, effect.baseRef)
      return
    }
    case 'ask-agent-for-setup-script': {
      handleAskAgentForSetupScriptEffect(ctx)
      return
    }
    case 'promote-setup-tab': {
      handlePromoteSetupTabEffect(ctx)
      return
    }
    case 'activate-settings-row': {
      changeSelectedSetting(ctx)
      return
    }
    case 'adjust-settings-row': {
      changeSelectedSetting(ctx, effect.delta)
      return
    }
    case 'confirm-settings-search': {
      confirmSettingsSearch(ctx)
      return
    }
    case 'reset-settings-row': {
      resetSelectedSetting(ctx)
      return
    }
    case 'commit-setting-text': {
      commitSettingText(ctx, effect.settingId, effect.value)
      return
    }
    default:
      effect satisfies never
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
  // `bun update -g` is a no-op when the global entry pins an exact version
  // (`"@brimveyn/aimux": "1.22.2"`), which is what `install -g pkg@version`
  // writes — the update "succeeded", the version never moved, and the modal
  // came back every launch. Install the resolved version explicitly instead.
  const proc = Bun.spawn(
    ['bun', 'install', '-g', `@brimveyn/aimux@${latestVersion}`, '@brimveyn/aimux-config@latest'],
    {
      stderr: 'inherit',
      stdin: 'inherit',
      stdout: 'inherit',
    }
  )
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

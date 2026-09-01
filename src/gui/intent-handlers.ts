import type { GuiIntent } from '@aimux/gui-protocol'

import type { AppAction } from '../state/actions'
import type { AppState, GitFileSection, SnippetRecord } from '../state/types'
import type { GuiRuntime } from './runtime'

import { enqueueGitOp } from '../git/command-queue'
import { listGhAccounts, nextGhAccount, switchGhAccount } from '../git/gh-auth'
import { approveAndMergePr } from '../git/pr-merge'
import { prActionState, prCleanupKind } from '../git/pr-status'
import { refreshPrStatus } from '../git/pr-status-poller'
import { checkoutBranch } from '../git/worktree'
import { createPrefixedId } from '../platform/id'
import { openUrl } from '../platform/open-url'
import { prStatusStore } from '../state/pr-status-store'
import { getCurrentProject } from '../state/project-workspaces'
import { isConfigSnippetId, saveSnippetCatalog } from '../state/snippet-catalog'
import { toast } from '../state/toast-store'
import {
  getActiveWorkspace,
  getActiveWorkspacePath,
  getPrimaryWorkspace,
} from '../state/workspace-view'
import { orderProjectsForDisplay } from '../ui/project-ordering'

// Discriminated intent → existing reducer-action / pipeline-call dispatch.
// Hard rule (roadmap, DB1): "Tout intent GUI doit aboutir à une action du
// reducer partagé." This file MUST NOT introduce a parallel state machine or
// touch shared reducer code — every branch composes pre-existing actions /
// side-effects through `runtime.dispatch` and `runtime.pipeline`.
export function dispatchIntent(intent: GuiIntent, runtime: GuiRuntime): void {
  switch (intent.kind) {
    case 'modal.snippet.submit':
      // Roadmap P1.3 — client-authoritative snippet editor. The committed
      // values are carried in the intent payload (the React modal owns the
      // in-flight buffers), so this branch can't go through
      // `actions.saveSnippetEditor` (which reads buffers from `state.modal`).
      // We mirror the TUI's reducer/side-effect tail (catalog write +
      // `set-snippets` dispatch) via `applySnippetSubmit`, then close the
      // modal — same observable outcome as the keyboard-driven save.
      handleSnippetSubmit(intent, runtime)
      return
    case 'modal.submit':
      runtime.pipeline.confirmActiveModal()
      return
    case 'modal.cancel':
      runtime.dispatch({ type: 'close-modal' })
      return
    case 'modal.snippet.cancel':
      // Mirrors TUI `backToSnippetPicker` (packages/aimux-config/src/actions.ts:306):
      // single reducer action that transitions modal.type from snippet-editor
      // back to snippet-picker, preserving the picker context.
      runtime.dispatch({ type: 'open-snippet-picker' })
      return
    case 'git.stageFile':
      handleGitStage(intent.path, runtime)
      return
    case 'git.unstageFile':
      handleGitUnstage(intent.path, runtime)
      return
    case 'git.discardFile':
      handleGitDiscard(intent.path, runtime)
      return
    case 'git.toggleFolder':
      // Mirrors the TUI FolderRow onMouseDown handler (src/ui/components/git/git-panel.tsx:183-185):
      // a bare `git-mode-toggle-folder` dispatch with the row's key.
      runtime.dispatch({ key: intent.key, type: 'git-mode-toggle-folder' })
      return
    case 'tabs.reorder':
      // Same dispatch the TUI's tab-strip drag commits (top-tab-bar.tsx):
      // the reducer rewrites only the visible tabs' slots.
      runtime.dispatch({ orderedTabIds: intent.orderedTabIds, type: 'reorder-tabs' })
      return
    case 'workspace.activate':
      handleWorkspaceActivate(intent, runtime)
      return
    case 'project.activate':
      handleProjectActivate(intent, runtime)
      return
    case 'project.toggleCollapsed':
      runtime.pipeline.runEffect({
        projectId: intent.projectId,
        type: 'toggle-project-collapsed',
      })
      return
    case 'project.newWorkspace':
      handleNewWorkspace(intent, runtime)
      return
    case 'project.new':
      runtime.dispatch({ returnToProjectPicker: false, type: 'open-create-project-modal' })
      return
    case 'projects.reorder':
      runtime.dispatch({ orderedIds: intent.orderedIds, type: 'reorder-projects' })
      return
    case 'view.settings':
      runtime.dispatch({ type: 'enter-settings' })
      return
    case 'view.stats':
      runtime.dispatch({ type: 'enter-stats' })
      return
    case 'url.open':
      openUrl(intent.url)
      return
    case 'pr.act':
      handlePrAction(runtime)
      return
    case 'gh.switchAccount':
      handleGhSwitchAccount(runtime)
      return
    case 'setup.action': {
      const effects = {
        'ask-agent': { type: 'ask-agent-for-setup-script' },
        'configure': { type: 'configure-setup-script' },
        'promote': { type: 'promote-setup-tab' },
        'run': { type: 'run-setup' },
        'stop': { type: 'stop-setup' },
      } as const
      runtime.pipeline.runEffect(effects[intent.action])
      return
    }
    case 'bar.menuAction':
      // The action is one of the store's own, already narrowed by the parser.
      runtime.dispatch(intent.action)
      return
    case 'git.toggleFileListMode': {
      const next = runtime.getState().gitPane.fileListMode === 'tree' ? 'flat' : 'tree'
      runtime.dispatch({ type: 'git-mode-toggle-file-list-mode' })
      runtime.pipeline.runEffect({ mode: next, type: 'persist-git-file-list-mode' })
      return
    }
  }
}

/**
 * `switch-project-by-index` addresses projects by their **1-based position in
 * display order** (see `handleSwitchProjectByIndex`), not by their position in
 * `state.projects`. Getting that wrong is why clicking a workspace in another
 * project did nothing: the effect looked up `ordered[index - 1]` and either
 * missed or landed on a neighbour.
 */
function displayIndexOf(runtime: GuiRuntime, projectId: string): number | null {
  const ordered = orderProjectsForDisplay(runtime.getState().projects)
  const index = ordered.findIndex((project) => project.id === projectId)
  return index < 0 ? null : index + 1
}

/**
 * Mirrors `workspace-row.tsx`'s mouse-down: inside the current project it is a
 * plain dispatch, but a cross-project click has to carry the workspace along
 * with the switch. Splitting that into dispatch-then-switch leaves a window
 * where the target project re-asserts its last-persisted workspace.
 */
function handleWorkspaceActivate(
  intent: Extract<GuiIntent, { kind: 'workspace.activate' }>,
  runtime: GuiRuntime
): void {
  if (runtime.getState().currentProjectId === intent.projectId) {
    runtime.dispatch({
      projectId: intent.projectId,
      type: 'set-active-workspace',
      workspaceId: intent.workspaceId,
    })
    return
  }
  const index = displayIndexOf(runtime, intent.projectId)
  if (index === null) return
  runtime.pipeline.runEffect({
    index,
    type: 'switch-project-by-index',
    workspaceId: intent.workspaceId,
  })
}

/**
 * `project-list.tsx`'s release handler. The heading stands for the project
 * itself, not for whichever workspace was last active in it, so it lands on
 * the checkout — the one workspace every project is guaranteed to have.
 */
function handleProjectActivate(
  intent: Extract<GuiIntent, { kind: 'project.activate' }>,
  runtime: GuiRuntime
): void {
  const index = displayIndexOf(runtime, intent.projectId)
  if (index === null) return
  const target = runtime.getState().projects.find((project) => project.id === intent.projectId)
  runtime.pipeline.runEffect({
    index,
    type: 'switch-project-by-index',
    workspaceId: getPrimaryWorkspace(target?.workspaces)?.id,
  })
}

/**
 * `project-list.tsx`'s `handleNewWorkspace`: the create-workspace modal always
 * targets the current project, so a click on another project's `+` has to
 * switch first. Both go through the store synchronously.
 */
function handleNewWorkspace(
  intent: Extract<GuiIntent, { kind: 'project.newWorkspace' }>,
  runtime: GuiRuntime
): void {
  if (runtime.getState().currentProjectId !== intent.projectId) {
    const index = displayIndexOf(runtime, intent.projectId)
    if (index === null) return
    runtime.pipeline.runEffect({ index, type: 'switch-project-by-index' })
  }
  runtime.dispatch({ type: 'open-create-workspace-modal' })
  runtime.pipeline.runEffect({ type: 'load-create-workspace-base-branches' })
}

/**
 * The PR row's button, as `pr-state-row.tsx` performs it. The renderer sends no
 * argument: what the action means is re-derived here from the same PR the
 * projection was built from, so a stale button cannot merge the wrong thing.
 */
function handlePrAction(runtime: GuiRuntime): void {
  const state = runtime.getState()
  const project = getCurrentProject(state)
  const workspace = getActiveWorkspace(project)
  const projectPath = getActiveWorkspacePath(project)
  if (projectPath == null || projectPath === '') return

  const result = prStatusStore.getState().result
  if (result?.kind !== 'ok') return
  const action = prActionState(result.pr, result.checks)
  const removableWorkspaceId =
    workspace !== undefined && workspace.source !== 'primary' ? workspace.id : null
  const cleanup = prCleanupKind(action.action, result.pr, removableWorkspaceId !== null)

  if (cleanup === 'worktree') {
    if (project === undefined || removableWorkspaceId === null) return
    // closeTabs (not force) mirrors the sidebar's "Remove workspace": the
    // workspace's tabs are disposed, but a dirty worktree still re-prompts for
    // an explicit force-delete instead of silently discarding work.
    runtime.pipeline.runEffect({
      closeTabs: true,
      projectId: project.id,
      type: 'delete-workspace',
      workspaceId: removableWorkspaceId,
    })
    return
  }

  if (cleanup === 'branch') {
    void (async () => {
      try {
        // Queued like every other mutating git op: the pollers read this same
        // checkout, and a checkout mid-status is how you get a torn panel.
        await enqueueGitOp(async () => checkoutBranch(projectPath, result.pr.base))
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error))
        return
      }
      await refreshPrStatus(projectPath)
    })()
    return
  }

  if (action.action !== 'merge') return
  void (async () => {
    const merged = await approveAndMergePr(projectPath)
    if (merged.ok) toast.success('Pull request merged')
    else toast.error(merged.message)
    await refreshPrStatus(projectPath)
  })()
}

/** `gh-error-state`'s one affordance: cycle to the next account and refetch. */
function handleGhSwitchAccount(runtime: GuiRuntime): void {
  const projectPath = getActiveWorkspacePath(getCurrentProject(runtime.getState()))
  void (async () => {
    const next = nextGhAccount(await listGhAccounts())
    if (next === null) {
      toast.error('No other GitHub account is signed in')
      return
    }
    const error = await switchGhAccount(next)
    if (error !== null) {
      toast.error(error)
      return
    }
    // The poller backs off to two minutes on errors; don't make the user wait
    // it out to find out whether the account they picked was the right one.
    if (projectPath != null && projectPath !== '') await refreshPrStatus(projectPath)
  })()
}

function handleSnippetSubmit(
  intent: Extract<GuiIntent, { kind: 'modal.snippet.submit' }>,
  runtime: GuiRuntime
): void {
  const state = runtime.getState()
  // The host owns `modal.projectTargetId` (set by `openSnippetEditor`); when
  // the intent omits `snippetId` (creation), we fall back to whatever the
  // open modal recorded. The intent value still wins when present — that's
  // the contract documented in `parseGuiIntent`.
  let snippetId: string | undefined = intent.snippetId
  if (snippetId === undefined && state.modal.type === 'snippet-editor') {
    snippetId = state.modal.projectTargetId ?? undefined
  }
  persistSnippetSubmit(
    {
      content: intent.content,
      name: intent.name,
      snippetId,
      trigger: intent.trigger,
    },
    state,
    runtime.dispatch
  )
  runtime.dispatch({ type: 'close-modal' })
}

// GUI-local persistence for the client-authoritative snippet editor (P1.3).
// Mirrors the validation rules of saveSnippetEditorState (trim, skip empty,
// config-pinned read-only) but reads from a caller-provided payload instead
// of state.modal.* — the modal owns its in-flight buffers in React. Reuses
// the same persistence tail (saveSnippetCatalog + set-snippets action) as
// the TUI's handleSaveSnippetEditorEffect, so both flows converge on the
// same on-disk + in-memory shape.
function persistSnippetSubmit(
  payload: { name: string; trigger: string; content: string; snippetId?: string },
  state: AppState,
  dispatch: (action: AppAction) => void
): void {
  const name = payload.name.trim()
  const content = payload.content.trim()
  const trimmedTrigger = payload.trigger.trim()
  if (name === '' || content === '') return

  const snippetId = payload.snippetId
  if (snippetId !== undefined && snippetId !== '' && isConfigSnippetId(snippetId)) return

  const trigger = trimmedTrigger.length > 0 ? trimmedTrigger : undefined

  const updated: SnippetRecord[] =
    snippetId !== undefined && snippetId !== ''
      ? state.snippets.map((snippet) =>
          snippet.id === snippetId ? { ...snippet, content, name, trigger } : snippet
        )
      : [...state.snippets, { content, id: createPrefixedId('snip'), name, trigger }]

  saveSnippetCatalog(updated)
  dispatch({ snippets: updated, type: 'set-snippets' })
}

// Mirrors `gitToggleSelected` in packages/aimux-config/src/actions.ts:611-628:
// optimistic-move into 'staged' + side-effect `git-stage`. The path-based
// intent skips the selection lookup but composes the same action/effect pair
// so the reducer + git pipeline see an identical sequence.
function handleGitStage(path: string, runtime: GuiRuntime): void {
  const file = runtime.getState().gitPanel.files.find((f) => f.path === path)
  if (file === undefined || file.section === 'staged') return
  const actions: AppAction[] = [
    {
      fromSection: file.section,
      path: file.path,
      toSection: 'staged',
      type: 'git-mode-optimistic-move',
    },
  ]
  runtime.pipeline.processKeyResult(
    { actions, effects: [{ path: file.path, type: 'git-stage' }] },
    'git-mode'
  )
}

// Mirrors the staged-section branch of `gitDestructiveSelected`
// (packages/aimux-config/src/actions.ts:642-652).
function handleGitUnstage(path: string, runtime: GuiRuntime): void {
  const file = runtime.getState().gitPanel.files.find((f) => f.path === path)
  if (file === undefined || file.section !== 'staged') return
  const toSection: GitFileSection = file.status === 'A' ? 'untracked' : 'unstaged'
  const actions: AppAction[] = [
    {
      fromSection: 'staged',
      path: file.path,
      toSection,
      type: 'git-mode-optimistic-move',
    },
  ]
  runtime.pipeline.processKeyResult(
    { actions, effects: [{ path: file.path, type: 'git-unstage' }] },
    'git-mode'
  )
}

// Mirrors the destructive (non-staged) branch of `gitDestructiveSelected`
// (packages/aimux-config/src/actions.ts:654-668), bypassing the pending-delete
// confirmation step — the GUI surfaces its own confirmation UI before sending
// the intent. Untracked → `git-rm`, tracked → `git-restore`.
function handleGitDiscard(path: string, runtime: GuiRuntime): void {
  const file = runtime.getState().gitPanel.files.find((f) => f.path === path)
  if (file === undefined || file.section === 'staged') return
  const isUntracked = file.section === 'untracked'
  const actions: AppAction[] = [
    { path: null, type: 'git-mode-set-pending-delete' },
    {
      fromSection: file.section,
      path: file.path,
      toSection: null,
      type: 'git-mode-optimistic-move',
    },
  ]
  const effectType = isUntracked ? 'git-rm' : 'git-restore'
  runtime.pipeline.processKeyResult(
    { actions, effects: [{ path: file.path, type: effectType }] },
    'git-mode'
  )
}

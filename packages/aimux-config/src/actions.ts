import type { ActionFn, AppAction, KeyResult, ModeContext, ModeId } from './types'

import { isAutoCommitEnabled } from './auto-commit-runtime'

const AUTO_COMMIT_DISABLED_MESSAGE =
  'auto-commit is disabled — set autoCommit: { enabled: true } in aimux.config.ts'

function r(
  actions: KeyResult['actions'] = [],
  effects: KeyResult['effects'] = [],
  transition?: KeyResult['transition']
): KeyResult {
  return transition ? { actions, effects, transition } : { actions, effects }
}

// ---------------------------------------------------------------------------
// Static actions (KeyResult values — no ctx needed)
// ---------------------------------------------------------------------------

export const nextTab: KeyResult = r([{ delta: 1, type: 'move-active-tab' }])
export const prevTab: KeyResult = r([{ delta: -1, type: 'move-active-tab' }])

/**
 * Routed through an effect rather than opening the modal directly: tabs only
 * exist inside a workspace, and whether the project has one is the app's
 * business, not the keymap's. The effect opens the picker or explains why not.
 */
export const newTab: KeyResult = r([], [{ type: 'open-new-tab' }])
export const renameTab: KeyResult = r([{ type: 'open-rename-tab-modal' }], [], 'modal.rename-tab')
export const projectPicker: KeyResult = r(
  [{ type: 'open-project-picker' }],
  [],
  'modal.project-picker.filtering'
)
export const snippetPicker: KeyResult = r(
  [{ type: 'open-snippet-picker' }],
  [],
  'modal.snippet-picker.filtering'
)
export const themePicker: KeyResult = r(
  [{ type: 'open-theme-picker' }],
  [{ action: 'open', type: 'apply-theme' }],
  'modal.theme-picker.filtering'
)
export function helpModal(scope?: ModeId): KeyResult {
  return r([{ scope, type: 'open-help-modal' }])
}

export const openFlashJump: KeyResult = r(
  [{ type: 'open-flash-jump-modal' }],
  [],
  'modal.flash-jump'
)

export function toggleBar(side: 'left' | 'right'): KeyResult {
  return r([{ side, type: 'toggle-bar' }])
}
export const toggleSidebar: KeyResult = toggleBar('left')
export function toggleWidget(widgetId: string): KeyResult {
  return r([{ type: 'toggle-widget', widgetId }])
}
export const toggleGitPane: KeyResult = toggleWidget('git')
export const toggleProjectBar: KeyResult = r([{ type: 'toggle-project-bar' }])
export const toggleAIUsage: ActionFn = (ctx: ModeContext) => {
  if (ctx.state.modal.type === 'ai-usage') {
    return r([{ type: 'close-modal' }], [], 'navigation')
  }
  return r([{ type: 'open-ai-usage-modal' }], [], 'modal.ai-usage')
}

export const enterGitMode: KeyResult = r([{ type: 'enter-git-mode' }], [], 'git-mode')

export function switchProjectByIndex(index: number): KeyResult {
  return r([], [{ index, type: 'switch-project-by-index' }])
}

export function switchTabByIndex(index: number): KeyResult {
  return r([], [{ index, type: 'switch-tab-by-index' }])
}

export const nextSidebarItem: KeyResult = r([], [{ direction: 1, type: 'cycle-sidebar-item' }])
export const prevSidebarItem: KeyResult = r([], [{ direction: -1, type: 'cycle-sidebar-item' }])

export const splitVertical: KeyResult = r(
  [{ direction: 'vertical', type: 'open-split-picker' }],
  [],
  'modal.split-picker'
)
export const splitHorizontal: KeyResult = r(
  [{ direction: 'horizontal', type: 'open-split-picker' }],
  [],
  'modal.split-picker'
)

export const enterInsert: ActionFn = (ctx: ModeContext) => {
  if (!(ctx.state.activeTabId != null && ctx.state.activeTabId !== '')) return null
  return r([{ focusMode: 'terminal-input', type: 'set-focus-mode' }], [], 'terminal-input')
}

export const closeModal: KeyResult = r([{ type: 'close-modal' }], [], 'navigation')

export const closeOverlayModal: KeyResult = r([{ type: 'close-modal' }])

export const cancelNewTabModal: KeyResult = r([{ type: 'cancel-command-edit' }])

// ---------------------------------------------------------------------------
// Dynamic actions (need ctx at runtime — ActionFn)
// ---------------------------------------------------------------------------

export const closeTab: ActionFn = (ctx: ModeContext) => {
  const tabId = ctx.state.activeTabId
  if (!(tabId != null && tabId !== '')) return null
  return r([{ type: 'close-active-tab' }], [{ tabId, type: 'close-tab' }])
}

export const restartTab: ActionFn = (ctx: ModeContext) => {
  const tab = ctx.state.tabs.find((t) => t.id === ctx.state.activeTabId)
  if (!tab) return null
  return r([], [{ tab, type: 'restart-tab' }])
}

export const quit: ActionFn = (ctx: ModeContext) => {
  return r([], [{ state: ctx.state, type: 'quit' }])
}

// ---------------------------------------------------------------------------
// Parameterized factories
// ---------------------------------------------------------------------------

export function moveTab(delta: number): KeyResult {
  return r([{ delta, type: 'move-active-tab' }])
}

export function reorderTab(delta: number): KeyResult {
  return r([{ delta, type: 'reorder-active-tab' }])
}

export function reorderProject(delta: number): KeyResult {
  return r([{ delta, type: 'reorder-active-project' }])
}

export function resizeBar(side: 'left' | 'right', delta: number): KeyResult {
  return r([{ delta, side, type: 'resize-bar' }])
}

export function resizeSidebar(delta: number): KeyResult {
  return resizeBar('left', delta)
}

export function resizeWidget(widgetId: string, delta: number): KeyResult {
  return r([{ delta, type: 'resize-widget', widgetId }])
}

export function resizeGitPane(delta: number): KeyResult {
  return resizeWidget('git', delta)
}

export function resizeGitDiffPane(delta: number): ActionFn {
  return (ctx: ModeContext) => {
    const nextRatio = Math.max(0.2, Math.min(0.8, ctx.state.gitPane.diffModeRatio + delta))
    if (nextRatio === ctx.state.gitPane.diffModeRatio) return r([])
    return r(
      [{ delta, type: 'resize-git-diff-pane' }],
      [{ ratio: nextRatio, type: 'persist-git-diff-mode-ratio' }]
    )
  }
}

export function focusPane(direction: 'left' | 'right' | 'up' | 'down'): KeyResult {
  return r(
    [
      { direction, type: 'focus-pane-direction' },
      { focusMode: 'terminal-input', type: 'set-focus-mode' },
    ],
    [],
    'terminal-input'
  )
}

export function resizePane(delta: number, axis: 'horizontal' | 'vertical'): ActionFn {
  return (ctx: ModeContext) => {
    const tabId = ctx.state.activeTabId
    if (!(tabId != null && tabId !== '')) return null
    return r([{ axis, delta, tabId, type: 'resize-pane' }])
  }
}

export function moveModalSelection(delta: number): KeyResult {
  return r([{ delta, type: 'move-modal-selection' }])
}

export function moveModalSelectionWithPreview(
  delta: number,
  effects: KeyResult['effects']
): KeyResult {
  return r([{ delta, type: 'move-modal-selection' }], effects)
}

// ---------------------------------------------------------------------------
// Modal-specific actions
// ---------------------------------------------------------------------------

export const launchSelectedAssistant: KeyResult = r([], [{ type: 'launch-selected-assistant' }])

export const confirmWorkspaceDeleteModal: ActionFn = (ctx: ModeContext) => {
  const modal = ctx.state.modal
  if (modal.type !== 'workspace-delete-confirm') return null
  return r(
    [{ type: 'close-modal' }],
    [
      {
        closeTabs: modal.closeTabs,
        force: modal.force,
        projectId: modal.projectId,
        type: 'delete-workspace',
        workspaceId: modal.workspaceId,
      },
    ],
    'navigation'
  )
}

export const cancelCommandEdit = (returnTo: KeyResult['transition']): KeyResult =>
  r([{ type: 'cancel-command-edit' }], [], returnTo)

export const confirmSelectedProject: KeyResult = r([], [{ type: 'confirm-selected-project' }])

export const openCreateProjectModal: KeyResult = r(
  [{ returnToProjectPicker: true, type: 'open-create-project-modal' }],
  [],
  'modal.create-project'
)

export const createWorkspaceModal: KeyResult = r(
  [{ type: 'open-create-workspace-modal' }],
  [{ type: 'load-create-workspace-base-branches' }],
  'modal.create-workspace'
)

export const switchCreateWorkspaceField: KeyResult = r([{ type: 'switch-create-workspace-field' }])

/**
 * An empty prompt is not a workspace: it names nothing, branches nothing and
 * gives the assistant nothing to do, so Enter is simply inert until it is typed.
 */
export const confirmCreateWorkspace: ActionFn = (ctx: ModeContext) => {
  const { modal } = ctx.state
  if (modal.type === 'create-workspace' && modal.prompt.trim() === '') return r([])
  return r([], [{ type: 'create-workspace' }])
}

/**
 * `Enter` creates, so the prompt needs another way to break a line. Inverted
 * from the commit modal on purpose: there the body is the whole point, here
 * most prompts are one line and creating must stay the cheapest keystroke.
 */
export const createWorkspaceNewline: ActionFn = (ctx: ModeContext) => {
  const { modal } = ctx.state
  if (modal.type !== 'create-workspace') return r([])
  if (modal.activeField !== 'prompt') return r([])
  return r([{ char: '\n', type: 'update-command-edit' }])
}

export const createWorkspaceEscape: KeyResult = r([{ type: 'close-modal' }], [], 'navigation')

export const openRenameSelectedProject: KeyResult = r(
  [],
  [{ type: 'open-rename-selected-project' }]
)

export const deleteSelectedProject: KeyResult = r([], [{ type: 'delete-selected-project' }])

export const openSnippetEditor: KeyResult = r(
  [{ type: 'open-snippet-editor' }],
  [],
  'modal.snippet-editor'
)

export const editSelectedSnippet: KeyResult = r([], [{ type: 'edit-selected-snippet' }])
export const deleteSelectedSnippet: KeyResult = r([], [{ type: 'delete-selected-snippet' }])
export const openSelectedSnippetSourceInEditor: KeyResult = r(
  [],
  [{ type: 'open-selected-snippet-source-in-editor' }]
)

export const pasteSelectedSnippet: KeyResult = r(
  [{ type: 'close-modal' }],
  [{ type: 'paste-selected-snippet' }],
  'navigation'
)

export const pasteSnippetToGroup: KeyResult = r(
  [{ type: 'close-modal' }],
  [{ type: 'paste-snippet-to-group' }],
  'navigation'
)

export const confirmSplit: KeyResult = r([], [{ type: 'confirm-split' }])

export const restoreTheme: KeyResult = r(
  [{ type: 'close-modal' }],
  [{ action: 'restore', type: 'apply-theme' }],
  'navigation'
)

export const confirmTheme: KeyResult = r(
  [{ type: 'close-modal' }],
  [{ action: 'confirm', type: 'apply-theme' }],
  'navigation'
)

export function previewTheme(delta: 1 | -1): KeyResult {
  return r(
    [{ delta, type: 'move-modal-selection' }],
    [{ action: 'preview', delta, type: 'apply-theme' }]
  )
}

export const toggleTransparent: KeyResult = r([], [{ type: 'toggle-transparent' }])
export const toggleMode: KeyResult = r([], [{ type: 'toggle-mode' }])

export const switchField: KeyResult = r([{ type: 'switch-create-project-field' }])
export const selectDirectory: KeyResult = r([{ type: 'select-directory' }])

export const backToProjectPicker: KeyResult = r(
  [{ type: 'open-project-picker' }],
  [],
  'modal.project-picker.filtering'
)

export const createProjectEscape: ActionFn = (ctx: ModeContext) => {
  if (ctx.state.modal.type === 'create-project' && !ctx.state.modal.returnToProjectPicker) {
    return r([{ type: 'close-modal' }], [], 'navigation')
  }
  return r([{ type: 'open-project-picker' }], [], 'modal.project-picker.filtering')
}

export const backToSnippetPicker: KeyResult = r(
  [{ type: 'open-snippet-picker' }],
  [],
  'modal.snippet-picker.filtering'
)

export const saveSnippetEditor: KeyResult = r(
  [{ type: 'close-modal' }],
  [{ type: 'save-snippet-editor' }],
  'navigation'
)

export const saveCustomCommand: KeyResult = r(
  [],
  [{ type: 'save-custom-command' }],
  'modal.new-tab.command-edit'
)

export const cancelEditCustomCommand: KeyResult = r(
  [{ type: 'cancel-command-edit' }],
  [],
  'modal.new-tab.command-edit'
)

export const editSelectedAssistant: KeyResult = r(
  [],
  [{ type: 'edit-selected-assistant' }],
  'modal.new-tab.editing-command'
)

// ---------------------------------------------------------------------------
// Update-available modal
// ---------------------------------------------------------------------------

export const confirmUpdateSelection: KeyResult = r(
  [{ type: 'close-modal' }],
  [{ type: 'confirm-update-selection' }],
  'navigation'
)

// ---------------------------------------------------------------------------
// Workspace-move modal
// ---------------------------------------------------------------------------

export const openWorkspaceMove: ActionFn = (ctx: ModeContext) => {
  if (ctx.state.gitMode.headOffset > 0) {
    return r([
      {
        message: 'disabled while viewing HEAD~N (press 0 or [ to return)',
        type: 'git-mode-set-message',
      },
    ])
  }
  const project = ctx.state.projects.find((entry) => entry.id === ctx.state.currentProjectId)
  const workspaces = project?.workspaces ?? []
  // From git mode, the source is the active workspace (the one being reviewed).
  const source = workspaces.find((w) => w.id === project?.activeWorkspaceId) ?? workspaces[0]
  const hasBranch = source != null && source.branch != null && source.branch !== ''
  const others = workspaces.filter((w) => w.id !== source?.id)
  if (!hasBranch || source == null || others.length < 1) {
    return r([{ message: 'no other workspace to move into', type: 'git-mode-set-message' }])
  }
  // Overlay: no mode transition — deriveModeId routes input to the picker and
  // focusMode stays 'git' so the git view remains mounted underneath.
  return r(
    [{ sourceWorkspaceId: source.id, type: 'open-workspace-move-modal' }],
    [{ type: 'load-workspace-move-stats' }]
  )
}

export const toggleWorkspaceMoveDelete: KeyResult = r([{ type: 'toggle-workspace-move-delete' }])

export const confirmWorkspaceMove: ActionFn = (ctx: ModeContext) => {
  const modal = ctx.state.modal
  const project = ctx.state.projects.find((entry) => entry.id === ctx.state.currentProjectId)
  const workspaces = project?.workspaces ?? []
  const sourceId = modal.type === 'workspace-move' ? modal.sourceWorkspaceId : undefined
  const source = workspaces.find((w) => w.id === sourceId)
  const targets = workspaces.filter((w) => w.id !== sourceId)
  const selectedIndex = modal.type === 'workspace-move' ? modal.selectedIndex : 0
  const target = targets[selectedIndex]
  if (!target || !project || !source || modal.type !== 'workspace-move') {
    return r([{ type: 'close-modal' }])
  }
  // Overlay close keeps focusMode 'git' (see close-modal reducer), so the move
  // result lands back in the git view that was underneath the picker.
  return r(
    [{ type: 'close-modal' }],
    [
      {
        deleteSource: modal.deleteSource,
        projectId: project.id,
        sourceWorkspaceId: source.id,
        targetWorkspaceId: target.id,
        type: 'move-workspace',
      },
    ]
  )
}

// Confirms the dialog opened after a recoverable move failure: re-runs the
// move with the flag matching the failure (stash the target / keep conflicts).
export const confirmWorkspaceMoveRetry: ActionFn = (ctx: ModeContext) => {
  const modal = ctx.state.modal
  if (modal.type !== 'workspace-move-confirm') return null
  return r(
    [{ type: 'close-modal' }],
    [
      {
        deleteSource: modal.deleteSource,
        projectId: modal.projectId,
        sourceWorkspaceId: modal.sourceWorkspaceId,
        targetWorkspaceId: modal.targetWorkspaceId,
        type: 'move-workspace',
        ...(modal.variant === 'stash-target' ? { stashTarget: true } : { keepConflicts: true }),
      },
    ],
    'navigation'
  )
}

export const closePane: ActionFn = (ctx: ModeContext) => {
  const tabId = ctx.state.activeTabId
  if (!(tabId != null && tabId !== '')) return null
  return r(
    [
      { tabId, type: 'close-pane' },
      { focusMode: 'terminal-input', type: 'set-focus-mode' },
    ],
    [{ tabId, type: 'close-tab' }],
    'terminal-input'
  )
}

// Navigation-specific dynamic actions
// Reveals whichever bar hosts the project list — it is not pinned to the left.
export const ctrlZSidebar: ActionFn = (ctx: ModeContext) => {
  const side = ctx.state.bars.left.widgets.some((w) => w.id === 'projects') ? 'left' : 'right'
  if (!ctx.state.bars[side].visible) {
    return r([{ side, type: 'toggle-bar' }])
  }
  return r([])
}

// ---------------------------------------------------------------------------
// Terminal-input escape shortcuts (used by raw-input-handler)
// These fire while the user is actively in terminal-input mode.
// ---------------------------------------------------------------------------

export const leaveTerminalInput: KeyResult = r(
  [{ focusMode: 'navigation', type: 'set-focus-mode' }],
  [],
  'navigation'
)

export const toggleSidebarFromInput: KeyResult = toggleBar('left')

// Project name modal
export const confirmProjectRename: ActionFn = (ctx: ModeContext) => {
  const trimmed = (ctx.state.modal.editBuffer ?? '').trim()
  const projectId = ctx.state.modal.projectTargetId
  const returnToPicker =
    ctx.state.modal.type === 'project-name' ? ctx.state.modal.returnToProjectPicker : true
  const closeAction: AppAction = returnToPicker
    ? { type: 'open-project-picker' }
    : { type: 'close-modal' }
  const transition: KeyResult['transition'] = returnToPicker
    ? 'modal.project-picker.filtering'
    : 'navigation'
  const effects: KeyResult['effects'] =
    trimmed && projectId != null && projectId !== ''
      ? [{ name: trimmed, projectId, type: 'rename-project' }]
      : []
  return r([closeAction], effects, transition)
}

// Rename tab modal
export const confirmRenameTab: ActionFn = (ctx: ModeContext) => {
  const trimmed = (ctx.state.modal.editBuffer ?? '').trim()
  const tabId = ctx.state.modal.projectTargetId
  const actions: KeyResult['actions'] = []
  const effects: KeyResult['effects'] = []
  if (trimmed && tabId != null && tabId !== '') {
    effects.push({ tabId, title: trimmed, type: 'rename-tab' })
  }
  actions.push({ type: 'close-modal' })
  return r(actions, effects, 'navigation')
}

// Rename workspace modal
export const confirmRenameWorkspace: ActionFn = (ctx: ModeContext) => {
  const { modal } = ctx.state
  const trimmed = (modal.editBuffer ?? '').trim()
  const workspaceId = modal.projectTargetId
  const projectId = modal.type === 'rename-workspace' ? modal.workspaceProjectId : null
  const actions: KeyResult['actions'] = []
  if (
    trimmed &&
    workspaceId != null &&
    workspaceId !== '' &&
    projectId != null &&
    projectId !== ''
  ) {
    actions.push({
      patch: { name: trimmed },
      projectId,
      type: 'update-workspace-record',
      workspaceId,
    })
  }
  actions.push({ type: 'close-modal' })
  return r(actions, [], 'navigation')
}

// Create project modal
export const confirmCreateProject: ActionFn = (ctx: ModeContext) => {
  const modal = ctx.state.modal as {
    activeField?: string
    editBuffer?: string
    pendingProjectPath?: string
  }

  if (modal.activeField === 'directory') {
    return r([{ type: 'select-directory' }])
  }

  const trimmed = (modal.editBuffer ?? '').trim()
  const projectPath = modal.pendingProjectPath ?? undefined
  const projectName = trimmed || getDefaultProjectName(projectPath)
  if (projectName) {
    return r(
      [{ type: 'close-modal' }],
      [{ name: projectName, projectPath, type: 'create-project' }],
      'navigation'
    )
  }
  return r([{ type: 'close-modal' }], [], 'navigation')
}

function getDefaultProjectName(projectPath?: string): string {
  if (!(projectPath != null && projectPath !== '')) return ''
  const segments = projectPath.split('/').filter(Boolean)
  return segments.at(-1) ?? ''
}

// Project picker escape (conditional)
export const projectPickerEscape: ActionFn = (ctx: ModeContext) => {
  if (!(ctx.state.currentProjectId != null && ctx.state.currentProjectId !== '')) return null
  return r([{ type: 'close-modal' }], [], 'navigation')
}

// Snippet filter: paste from filter + close
export const snippetFilterPaste: KeyResult = r(
  [{ type: 'close-modal' }],
  [{ type: 'paste-selected-snippet' }],
  'navigation'
)

export const snippetFilterPasteToGroup: KeyResult = r(
  [{ type: 'close-modal' }],
  [{ type: 'paste-snippet-to-group' }],
  'navigation'
)

// ---------------------------------------------------------------------------
// Git mode (src/input/modes/handlers/git-mode.ts replacement)
// ---------------------------------------------------------------------------

function clearPendingDelete(ctx: ModeContext): AppAction[] {
  if (ctx.state.gitMode.pendingDeletePath === null) return []
  return [{ path: null, type: 'git-mode-set-pending-delete' }]
}

function gitFileKey(section: string, path: string, repoPath?: string): string {
  return repoPath != null && repoPath !== ''
    ? `${section}:${repoPath}:${path}`
    : `${section}:${path}`
}

function selectedGitFile(ctx: ModeContext) {
  const key = ctx.state.gitMode.selectedEntryKey
  if (!(key != null && key !== '')) return null
  return (
    ctx.state.gitPanel.files.find(
      (file) => gitFileKey(file.section, file.path, file.repoPath) === key
    ) ?? null
  )
}

export const exitGitMode: KeyResult = r([{ type: 'exit-git-mode' }], [], 'navigation')

export function selectGitFile(delta: -1 | 1): ActionFn {
  return (ctx: ModeContext) => {
    if (ctx.state.gitPanel.files.length === 0) return r([])
    return r([{ delta, type: 'git-mode-move-selection' }])
  }
}

export function selectGitFileOnly(delta: -1 | 1): ActionFn {
  return (ctx: ModeContext) => {
    if (ctx.state.gitPanel.files.length === 0) return r([])
    return r([{ delta, type: 'git-mode-move-file-selection' }])
  }
}

export const toggleSelectedGitFolder: ActionFn = (ctx: ModeContext) => {
  if (!(ctx.state.gitMode.selectedEntryKey != null && ctx.state.gitMode.selectedEntryKey !== ''))
    return r([])
  return r([{ type: 'git-mode-toggle-selected-folder' }])
}

export const collapseGitSelection: ActionFn = (ctx: ModeContext) => {
  if (!(ctx.state.gitMode.selectedEntryKey != null && ctx.state.gitMode.selectedEntryKey !== ''))
    return r([])
  return r([{ type: 'git-mode-collapse-selection' }])
}

export const expandGitSelection: ActionFn = (ctx: ModeContext) => {
  if (!(ctx.state.gitMode.selectedEntryKey != null && ctx.state.gitMode.selectedEntryKey !== ''))
    return r([])
  return r([{ type: 'git-mode-expand-selection' }])
}

export const toggleGitFileListMode: ActionFn = (ctx: ModeContext) => {
  const mode = ctx.state.gitPane.fileListMode === 'tree' ? 'flat' : 'tree'
  return r(
    [{ type: 'git-mode-toggle-file-list-mode' }],
    [{ mode, type: 'persist-git-file-list-mode' }]
  )
}

export const toggleTreeCompaction: ActionFn = (ctx: ModeContext) => {
  const enabled = !ctx.state.gitPane.treeCompaction
  return r(
    [{ type: 'git-mode-toggle-tree-compaction' }],
    [{ enabled, type: 'persist-git-tree-compaction' }]
  )
}

export function scrollGitDiff(delta: number): KeyResult {
  return r([], [{ delta, type: 'scroll-git-diff' }])
}

export const toggleGitDiffView: KeyResult = r([{ type: 'git-mode-toggle-diff-view' }])

export const toggleGitReviewBase: KeyResult = r([{ type: 'git-mode-toggle-review-base' }])

export function shiftGitHeadOffset(delta: number): KeyResult {
  return r([
    { delta, type: 'git-mode-shift-head-offset' },
    { message: null, type: 'git-mode-set-message' },
  ])
}

export const gitStageSelected: ActionFn = (ctx: ModeContext) => {
  if (ctx.state.gitMode.headOffset > 0) {
    return r([
      {
        message: 'disabled while viewing HEAD~N (press 0 or [ to return)',
        type: 'git-mode-set-message',
      },
    ])
  }
  const file = selectedGitFile(ctx)
  if (!file) return r(clearPendingDelete(ctx))
  const actions = clearPendingDelete(ctx)
  if (file.section === 'staged') return r(actions)
  actions.push({
    fromSection: file.section,
    path: file.path,
    toSection: 'staged',
    type: 'git-mode-optimistic-move',
  })
  return r(actions, [{ path: file.path, type: 'git-stage' }])
}

export const gitDestructiveSelected: ActionFn = (ctx: ModeContext) => {
  if (ctx.state.gitMode.headOffset > 0) {
    return r([
      {
        message: 'disabled while viewing HEAD~N (press 0 or [ to return)',
        type: 'git-mode-set-message',
      },
    ])
  }
  const file = selectedGitFile(ctx)
  if (!file) return r(clearPendingDelete(ctx))

  if (file.section === 'staged') {
    const actions = clearPendingDelete(ctx)
    const toSection = file.status === 'A' ? 'untracked' : 'unstaged'
    actions.push({
      fromSection: 'staged',
      path: file.path,
      toSection,
      type: 'git-mode-optimistic-move',
    })
    return r(actions, [{ path: file.path, type: 'git-unstage' }])
  }

  const isUntracked = file.section === 'untracked'
  const pending = ctx.state.gitMode.pendingDeletePath

  if (pending === file.path) {
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
    return r(actions, [{ path: file.path, type: effectType }])
  }

  return r([{ path: file.path, type: 'git-mode-set-pending-delete' }])
}

export const gitToggleFoldAll: ActionFn = (ctx: ModeContext) => {
  const file = selectedGitFile(ctx)
  if (!file) return r([])
  const key = gitFileKey(file.section, file.path, file.repoPath)
  return r([{ key, type: 'git-mode-fold-toggle-all' }])
}

export const gitStageAll: ActionFn = (ctx: ModeContext) => {
  if (ctx.state.gitMode.headOffset > 0) {
    return r([
      {
        message: 'disabled while viewing HEAD~N (press 0 or [ to return)',
        type: 'git-mode-set-message',
      },
    ])
  }
  const files = ctx.state.gitPanel.files
  const pending = clearPendingDelete(ctx)
  if (files.length === 0) return r(pending)
  const actions: AppAction[] = [...pending]
  for (const f of files) {
    if (f.section === 'staged') continue
    actions.push({
      fromSection: f.section,
      path: f.path,
      toSection: 'staged',
      type: 'git-mode-optimistic-move',
    })
  }
  return r(actions, [{ type: 'git-stage-all' }])
}

export const gitUnstageAll: ActionFn = (ctx: ModeContext) => {
  if (ctx.state.gitMode.headOffset > 0) {
    return r([
      {
        message: 'disabled while viewing HEAD~N (press 0 or [ to return)',
        type: 'git-mode-set-message',
      },
    ])
  }
  const files = ctx.state.gitPanel.files
  const pending = clearPendingDelete(ctx)
  if (files.length === 0) return r(pending)
  const actions: AppAction[] = [...pending]
  for (const f of files) {
    if (f.section !== 'staged') continue
    const toSection = f.status === 'A' ? 'untracked' : 'unstaged'
    actions.push({
      fromSection: 'staged',
      path: f.path,
      toSection,
      type: 'git-mode-optimistic-move',
    })
  }
  return r(actions, [{ type: 'git-unstage-all' }])
}

export const gitCommitOpen: ActionFn = (ctx: ModeContext) => {
  if (ctx.state.gitMode.headOffset > 0) {
    return r([
      {
        message: 'disabled while viewing HEAD~N (press 0 or [ to return)',
        type: 'git-mode-set-message',
      },
    ])
  }
  const projectId = ctx.state.currentProjectId ?? undefined
  return r(
    [...clearPendingDelete(ctx), { projectId, type: 'open-git-commit-modal' }],
    [],
    'modal.git-commit'
  )
}

export const gitPush: ActionFn = (ctx: ModeContext) => {
  if (ctx.state.gitMode.headOffset > 0) {
    return r([
      {
        message: 'disabled while viewing HEAD~N (press 0 or [ to return)',
        type: 'git-mode-set-message',
      },
    ])
  }
  return r(clearPendingDelete(ctx), [{ type: 'git-push' }])
}

export const openSelectedGitFileInEditor: ActionFn = (ctx: ModeContext) => {
  const file = selectedGitFile(ctx)
  if (!file) return r([])
  return r([], [{ path: file.path, type: 'open-file-in-editor' }])
}

// ---------------------------------------------------------------------------
// Modal: git-commit
// ---------------------------------------------------------------------------

function extractGitCommitFields(modal: ModeContext['state']['modal']): {
  title: string
  body: string
} | null {
  if (modal.type !== 'git-commit') return null
  const editBuffer = modal.editBuffer ?? ''
  const activeIsTitle = modal.activeField === 'title'
  const title = (activeIsTitle ? editBuffer : modal.contentBuffer).trim()
  const body = (activeIsTitle ? modal.contentBuffer : editBuffer).trim()
  return { body, title }
}

export const gitCommitCancel: ActionFn = (ctx: ModeContext) => {
  const modal = ctx.state.modal
  if (modal.type === 'git-commit' && modal.stage === 'confirm') {
    return r([{ type: 'git-commit-leave-confirm' }], [], 'modal.git-commit')
  }
  return r([{ type: 'close-modal' }], [], 'git-mode')
}

export const gitCommitEnterConfirm: ActionFn = (ctx: ModeContext) => {
  const modal = ctx.state.modal
  if (modal.type !== 'git-commit') return null
  if (!isAutoCommitEnabled()) {
    return r([{ message: AUTO_COMMIT_DISABLED_MESSAGE, type: 'git-mode-set-message' }])
  }
  const fields = extractGitCommitFields(modal)
  const hasTitle = !!fields && fields.title.length > 0
  if (hasTitle) {
    return r([{ type: 'git-commit-enter-confirm' }], [], 'modal.git-commit.confirm')
  }
  const projectId = ctx.state.currentProjectId
  if (!(projectId != null && projectId !== '')) {
    return r([{ type: 'git-commit-enter-confirm' }], [], 'modal.git-commit.confirm')
  }
  return r(
    [{ projectId, type: 'git-commit-enter-generating' }],
    [{ projectId, type: 'generate-auto-commit-now' }],
    'modal.git-commit.generating'
  )
}

export const gitCommitLeaveConfirm: KeyResult = r(
  [{ type: 'git-commit-leave-confirm' }],
  [],
  'modal.git-commit'
)

export const gitCommitLeaveGenerating: ActionFn = (ctx: ModeContext) => {
  const projectId = ctx.state.currentProjectId
  const actionsList: AppAction[] = [{ type: 'git-commit-leave-generating' }]
  if (projectId != null && projectId !== '') {
    actionsList.push({ projectId, type: 'auto-commit-clear' })
  }
  return r(actionsList, [], 'modal.git-commit')
}

export const gitCommitAutoAccept: ActionFn = (ctx: ModeContext) => {
  if (!isAutoCommitEnabled()) {
    return r([{ message: AUTO_COMMIT_DISABLED_MESSAGE, type: 'git-mode-set-message' }])
  }
  const fields = extractGitCommitFields(ctx.state.modal)
  if (!fields) {
    return r([{ type: 'close-modal' }], [], 'git-mode')
  }
  return r(
    [{ type: 'close-modal' }],
    [{ body: fields.body, title: fields.title, type: 'git-commit-auto' }],
    'git-mode'
  )
}

export const gitCommitSubmit: ActionFn = (ctx: ModeContext) => {
  const fields = extractGitCommitFields(ctx.state.modal)
  if (!fields) {
    return r([{ type: 'close-modal' }], [], 'git-mode')
  }
  return r(
    [{ type: 'close-modal' }],
    [{ body: fields.body, title: fields.title, type: 'git-commit' }],
    'git-mode'
  )
}

export const gitCommitReturnKey: ActionFn = (ctx: ModeContext) => {
  const modal = ctx.state.modal
  if (modal.type === 'git-commit' && modal.activeField === 'body') {
    return r([{ char: '\n', type: 'update-command-edit' }])
  }
  return r([{ type: 'switch-create-project-field' }])
}

// ---------------------------------------------------------------------------
// Deprecated aliases — 0.8.x names kept working for one release.
//
// The project/workspace/worktree rename moved every one of these. Aliases only
// exist where the old name still has a target: `toggleNewTabWorktree`,
// `deleteSelectedWorktree` and `confirmDeleteWorktree` were deleted outright
// when <C-n> stopped creating worktrees, so a config referencing them is a
// compile error on purpose.
//
// ponytail: drop these with the other rename shims.
// ---------------------------------------------------------------------------

/** @deprecated renamed to `projectPicker`. */
export const sessionPicker = projectPicker
/** @deprecated renamed to `openCreateProjectModal`. */
export const openCreateSessionModal = openCreateProjectModal
/** @deprecated renamed to `createProjectEscape`. */
export const createSessionEscape = createProjectEscape
/** @deprecated renamed to `confirmCreateProject`. */
export const confirmCreateSession = confirmCreateProject
/** @deprecated renamed to `reorderProject`. */
export const reorderSession = reorderProject
/** @deprecated renamed to `switchProjectByIndex`. */
export const switchSessionByIndex = switchProjectByIndex
/** @deprecated renamed to `toggleProjectBar`. */
export const toggleSessionBar = toggleProjectBar
/** @deprecated renamed to `openWorkspaceMove`. */
export const openWorktreeMove = openWorkspaceMove
/** @deprecated renamed to `toggleWorkspaceMoveDelete`. */
export const toggleWorktreeMoveDelete = toggleWorkspaceMoveDelete
/** @deprecated renamed to `confirmWorkspaceMove`. */
export const confirmWorktreeMove = confirmWorkspaceMove
/** @deprecated renamed to `confirmWorkspaceDeleteModal`. */
export const confirmWorktreeDeleteModal = confirmWorkspaceDeleteModal

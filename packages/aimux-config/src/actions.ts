import type { ActionFn, AppAction, KeyResult, ModeContext } from './types'

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

export const newTab: KeyResult = r([{ type: 'open-new-tab-modal' }], [], 'modal.new-tab')
export const renameTab: KeyResult = r([{ type: 'open-rename-tab-modal' }], [], 'modal.rename-tab')
export const sessionPicker: KeyResult = r(
  [{ type: 'open-session-picker' }],
  [],
  'modal.session-picker'
)
export const snippetPicker: KeyResult = r(
  [{ type: 'open-snippet-picker' }],
  [],
  'modal.snippet-picker'
)
export const themePicker: KeyResult = r(
  [{ type: 'open-theme-picker' }],
  [{ action: 'open', type: 'apply-theme' }],
  'modal.theme-picker'
)
export const helpModal: KeyResult = r([{ type: 'open-help-modal' }], [], 'modal.help')

export const toggleSidebar: KeyResult = r([{ type: 'toggle-sidebar' }])
export const toggleGitPane: KeyResult = r([{ type: 'toggle-git-pane' }])
export const toggleSessionBar: KeyResult = r([{ type: 'toggle-session-bar' }])

export function setGitPaneMode(mode: 'embedded' | 'pane'): KeyResult {
  return r([{ mode, type: 'set-git-pane-mode' }])
}

export function setGitPanePosition(position: 'top' | 'bottom' | 'left' | 'right'): KeyResult {
  return r([{ position, type: 'set-git-pane-position' }])
}
export const enterGitMode: KeyResult = r([{ type: 'enter-git-mode' }], [], 'git-mode')

export function switchSessionByIndex(index: number): KeyResult {
  return r([], [{ index, type: 'switch-session-by-index' }])
}

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
  if (!ctx.state.activeTabId) return null
  return r([{ focusMode: 'terminal-input', type: 'set-focus-mode' }], [], 'terminal-input')
}

export const closeModal: KeyResult = r([{ type: 'close-modal' }], [], 'navigation')

// ---------------------------------------------------------------------------
// Dynamic actions (need ctx at runtime — ActionFn)
// ---------------------------------------------------------------------------

export const closeTab: ActionFn = (ctx: ModeContext) => {
  const tabId = ctx.state.activeTabId
  if (!tabId) return null
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

export function resizeSidebar(delta: number): KeyResult {
  return r([{ delta, type: 'resize-sidebar' }])
}

export function resizeGitPane(delta: number): KeyResult {
  return r([{ delta, type: 'resize-git-pane' }])
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
    if (!tabId) return null
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

export const beginCommandEdit: KeyResult = r(
  [{ type: 'begin-command-edit' }],
  [],
  'modal.new-tab.command-edit'
)

export const cancelCommandEdit = (returnTo: KeyResult['transition']): KeyResult =>
  r([{ type: 'cancel-command-edit' }], [], returnTo)

export const commitCommandEdit: KeyResult = r(
  [{ type: 'commit-command-edit' }],
  [{ type: 'save-custom-command' }],
  'modal.new-tab'
)

export const confirmSelectedSession: KeyResult = r([], [{ type: 'confirm-selected-session' }])

export const openCreateSessionModal: KeyResult = r(
  [{ type: 'open-create-session-modal' }],
  [],
  'modal.create-session'
)

export const openRenameSelectedSession: KeyResult = r(
  [],
  [{ type: 'open-rename-selected-session' }]
)

export const deleteSelectedSession: KeyResult = r([], [{ type: 'delete-selected-session' }])

export const beginSessionFilter: KeyResult = r(
  [{ type: 'begin-session-filter' }],
  [],
  'modal.session-picker.filtering'
)

export const openSnippetEditor: KeyResult = r(
  [{ type: 'open-snippet-editor' }],
  [],
  'modal.snippet-editor'
)

export const editSelectedSnippet: KeyResult = r([], [{ type: 'edit-selected-snippet' }])
export const deleteSelectedSnippet: KeyResult = r([], [{ type: 'delete-selected-snippet' }])

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

export const beginSnippetFilter: KeyResult = r(
  [{ type: 'begin-snippet-filter' }],
  [],
  'modal.snippet-picker.filtering'
)

export const beginHelpFilter: KeyResult = r(
  [{ type: 'begin-help-filter' }],
  [],
  'modal.help.filtering'
)

export const beginThemeFilter: KeyResult = r(
  [{ type: 'begin-theme-filter' }],
  [],
  'modal.theme-picker.filtering'
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

export const switchField: KeyResult = r([{ type: 'switch-create-session-field' }])
export const selectDirectory: KeyResult = r([{ type: 'select-directory' }])

export const backToSessionPicker: KeyResult = r(
  [{ type: 'open-session-picker' }],
  [],
  'modal.session-picker'
)

export const backToSnippetPicker: KeyResult = r(
  [{ type: 'open-snippet-picker' }],
  [],
  'modal.snippet-picker'
)

export const saveSnippetEditor: KeyResult = r(
  [{ type: 'close-modal' }],
  [{ type: 'save-snippet-editor' }],
  'navigation'
)

// ---------------------------------------------------------------------------
// Update-available modal
// ---------------------------------------------------------------------------

export const confirmUpdateSelection: KeyResult = r(
  [{ type: 'close-modal' }],
  [{ type: 'confirm-update-selection' }],
  'navigation'
)

export const closePane: ActionFn = (ctx: ModeContext) => {
  const tabId = ctx.state.activeTabId
  if (!tabId) return null
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
export const ctrlZSidebar: ActionFn = (ctx: ModeContext) => {
  if (!ctx.state.sidebar.visible) {
    return r([{ type: 'toggle-sidebar' }])
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

export const toggleSidebarFromInput: KeyResult = r([{ type: 'toggle-sidebar' }])

// Session name modal
export const confirmSessionRename: ActionFn = (ctx: ModeContext) => {
  const trimmed = (ctx.state.modal.editBuffer ?? '').trim()
  const sessionId = ctx.state.modal.sessionTargetId
  if (trimmed && sessionId) {
    return r(
      [{ type: 'open-session-picker' }],
      [{ name: trimmed, sessionId, type: 'rename-session' }],
      'modal.session-picker'
    )
  }
  return r([{ type: 'open-session-picker' }], [], 'modal.session-picker')
}

// Rename tab modal
export const confirmRenameTab: ActionFn = (ctx: ModeContext) => {
  const trimmed = (ctx.state.modal.editBuffer ?? '').trim()
  const tabId = ctx.state.modal.sessionTargetId
  const actions: KeyResult['actions'] = []
  if (trimmed && tabId) {
    actions.push({ tabId, title: trimmed, type: 'rename-tab' })
  }
  actions.push({ type: 'close-modal' })
  return r(actions, [], 'navigation')
}

// Create session modal
export const confirmCreateSession: ActionFn = (ctx: ModeContext) => {
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
  const sessionName = trimmed || getDefaultSessionName(projectPath)
  if (sessionName) {
    return r(
      [{ type: 'close-modal' }],
      [{ name: sessionName, projectPath, type: 'create-session' }],
      'navigation'
    )
  }
  return r([{ type: 'close-modal' }], [], 'navigation')
}

function getDefaultSessionName(projectPath?: string): string {
  if (!projectPath) return ''
  const segments = projectPath.split('/').filter(Boolean)
  return segments.at(-1) ?? ''
}

// Session picker escape (conditional)
export const sessionPickerEscape: ActionFn = (ctx: ModeContext) => {
  if (!ctx.state.currentSessionId) return null
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

export const exitGitMode: KeyResult = r([{ type: 'exit-git-mode' }], [], 'navigation')

export function selectGitFile(delta: -1 | 1): ActionFn {
  return (ctx: ModeContext) => {
    const total = ctx.state.gitPanel.files.length
    if (total === 0) return r([])
    const current = ctx.state.gitMode.selectedFileIndex
    const next = (current + delta + total) % total
    if (next === current) return r([])
    return r([{ delta, type: 'git-mode-select-file' }])
  }
}

export function scrollGitDiff(delta: number): KeyResult {
  return r([], [{ delta, type: 'scroll-git-diff' }])
}

export const toggleGitDiffView: KeyResult = r([{ type: 'git-mode-toggle-diff-view' }])

export const gitStageSelected: ActionFn = (ctx: ModeContext) => {
  const file = ctx.state.gitPanel.files[ctx.state.gitMode.selectedFileIndex]
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
  const file = ctx.state.gitPanel.files[ctx.state.gitMode.selectedFileIndex]
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

export const gitCommitOpen: ActionFn = (ctx: ModeContext) => {
  return r([...clearPendingDelete(ctx), { type: 'open-git-commit-modal' }], [], 'modal.git-commit')
}

export const gitPush: ActionFn = (ctx: ModeContext) => {
  return r(clearPendingDelete(ctx), [{ type: 'git-push' }])
}

// ---------------------------------------------------------------------------
// Modal: git-commit
// ---------------------------------------------------------------------------

export const gitCommitCancel: KeyResult = r([{ type: 'close-modal' }], [], 'git-mode')

export const gitCommitSubmit: ActionFn = (ctx: ModeContext) => {
  const modal = ctx.state.modal
  if (modal.type !== 'git-commit') {
    return r([{ type: 'close-modal' }], [], 'git-mode')
  }
  const editBuffer = modal.editBuffer ?? ''
  const activeIsTitle = modal.activeField === 'title'
  const title = (activeIsTitle ? editBuffer : modal.contentBuffer).trim()
  const body = (activeIsTitle ? modal.contentBuffer : editBuffer).trim()
  return r([{ type: 'close-modal' }], [{ body, title, type: 'git-commit' }], 'git-mode')
}

export const gitCommitReturnKey: ActionFn = (ctx: ModeContext) => {
  const modal = ctx.state.modal
  if (modal.type === 'git-commit' && modal.activeField === 'body') {
    return r([{ char: '\n', type: 'update-command-edit' }])
  }
  return r([{ type: 'switch-create-session-field' }])
}

import type {
  AutoCommitConfig,
  AutoRenameConfig,
  MultiRepoConfig,
  ResolvedKeymapConfig,
} from './types'

import * as actions from './actions'
import { KeymapBuilder } from './keymap-builder'

export const DEFAULT_AUTO_COMMIT_CONFIG: AutoCommitConfig = {
  enabled: false,
  models: {
    claude: 'claude-haiku-4-5',
    codex: 'gpt-5-mini',
  },
  timeoutMs: 60_000,
}

export const DEFAULT_AUTO_RENAME_CONFIG: AutoRenameConfig = {
  enabled: true,
  maxAttempts: 3,
  minPromptWords: 3,
  models: {
    claude: 'claude-haiku-4-5',
    codex: 'gpt-5-mini',
  },
  settleMs: 2_500,
  timeoutMs: 15_000,
}

export const DEFAULT_MULTI_REPO_CONFIG: MultiRepoConfig = {
  enabled: true,
  maxDepth: 1,
}

/**
 * Build the default keymap — 1:1 transcription of all existing handlers.
 */
export function getDefaultKeymapConfig(): ResolvedKeymapConfig {
  const kb = new KeymapBuilder()
    .leader('<C-w>')
    .timeout(300)

    // -----------------------------------------------------------------------
    // Navigation mode
    // -----------------------------------------------------------------------
    .mode('navigation', (m) =>
      m
        .map('<C-c>', actions.quit, 'Quit')
        .map('<C-n>', actions.newTab, 'New tab')
        .map('<C-p>', actions.createWorkspaceModal, 'Create workspace')
        .map('<C-g>', actions.projectPicker, 'Project picker')
        .map('<C-z>', actions.ctrlZSidebar, 'Focus sidebar')
        .map('dd', actions.closeTab, 'Close tab')
        .map('<C-b>', actions.toggleSidebar, 'Toggle sidebar')
        .map('<C-r>', actions.restartTab, 'Restart tab')
        .map('<C-s>', actions.snippetPicker, 'Snippet picker')
        .map('<C-t>', actions.themePicker, 'Theme picker')
        .map('<C-h>', actions.resizeSidebar(-2), 'Sidebar narrower')
        .map('<C-l>', actions.resizeSidebar(2), 'Sidebar wider')
        .map('G', actions.toggleGitPane, 'Toggle git pane')
        .map('<C-d>', actions.enterGitMode, 'Enter git mode')
        .map('<C-j>', actions.resizeGitPane(-0.05), 'Git pane smaller')
        .map('<C-k>', actions.resizeGitPane(0.05), 'Git pane larger')
        .map('j', actions.nextSidebarItem, 'Next project/workspace')
        .map('k', actions.prevSidebarItem, 'Prev project/workspace')
        .map('l', actions.nextTab, 'Next tab')
        .map('h', actions.prevTab, 'Prev tab')
        .map('L', actions.reorderTab(1), 'Move tab right')
        .map('H', actions.reorderTab(-1), 'Move tab left')
        .map('J', actions.reorderProject(1), 'Move project down')
        .map('K', actions.reorderProject(-1), 'Move project up')
        .map('r', actions.renameTab, 'Rename tab')
        .map('i', actions.enterInsert, 'Focus terminal')
        .map('S', actions.openFlashJump, 'Flash jump')
        .map('?', actions.helpModal(), 'Help')
    )

    // -----------------------------------------------------------------------
    // Terminal-input mode
    // -----------------------------------------------------------------------
    .mode('terminal-input', (m) =>
      m
        .map('<C-z>', actions.leaveTerminalInput, 'Leave insert')
        .map('<C-b>', actions.toggleSidebarFromInput, 'Toggle sidebar')
        .map('<Leader>h', actions.focusPane('left'), 'Focus left')
        .map('<Leader>j', actions.focusPane('down'), 'Focus down')
        .map('<Leader>k', actions.focusPane('up'), 'Focus up')
        .map('<Leader>l', actions.focusPane('right'), 'Focus right')
        .map('<Leader>H', actions.resizePane(-1, 'vertical'), 'Shrink ←', { repeatable: true })
        .map('<Leader>L', actions.resizePane(1, 'vertical'), 'Grow →', { repeatable: true })
        .map('<Leader>K', actions.resizePane(-1, 'horizontal'), 'Shrink ↑', { repeatable: true })
        .map('<Leader>J', actions.resizePane(1, 'horizontal'), 'Grow ↓', { repeatable: true })
        .map('<Leader>|', actions.splitVertical, 'Split vertical')
        .map('<Leader>-', actions.splitHorizontal, 'Split horizontal')
        .map('<Leader>q', actions.closePane, 'Close pane')
    )

    // -----------------------------------------------------------------------
    // Project bar: same chords from nav and while typing in the terminal
    // -----------------------------------------------------------------------
    .mode(['navigation', 'terminal-input'], (m) =>
      m
        .map('<Leader>b', actions.toggleProjectBar, 'Toggle project bar')
        .map('<Leader>B', actions.toggleBar('right'), 'Toggle right bar')
        .map('<Leader>u', actions.toggleStats, 'Stats')
        .map('<Leader>,', actions.enterSettings, 'Settings')
        .map('<Leader>1', actions.switchTabByIndex(1), 'Tab 1')
        .map('<Leader>2', actions.switchTabByIndex(2), 'Tab 2')
        .map('<Leader>3', actions.switchTabByIndex(3), 'Tab 3')
        .map('<Leader>4', actions.switchTabByIndex(4), 'Tab 4')
        .map('<Leader>5', actions.switchTabByIndex(5), 'Tab 5')
        .map('<Leader>6', actions.switchTabByIndex(6), 'Tab 6')
        .map('<Leader>7', actions.switchTabByIndex(7), 'Tab 7')
        .map('<Leader>8', actions.switchTabByIndex(8), 'Tab 8')
        .map('<Leader>9', actions.switchTabByIndex(9), 'Tab 9')
    )

    // -----------------------------------------------------------------------
    // Git mode
    // -----------------------------------------------------------------------
    .mode('git-mode', (m) =>
      m
        .map('a', actions.gitStageSelected, 'Stage')
        .map('A', actions.gitStageAll, 'Stage all')
        .map('d', actions.gitDestructiveSelected, 'Unstage/delete')
        .map('D', actions.gitUnstageAll, 'Unstage all')
        .map('e', actions.gitToggleFoldAll, 'Expand/collapse all folds')
        .map('o', actions.openSelectedGitFileInEditor, 'Open in editor')
        .map('c', actions.gitCommitOpen, 'Commit')
        .map('m', actions.openWorkspaceMove, 'Move workspace')
        .map('p', actions.gitPush, 'Push')
        .map('v', actions.toggleGitDiffView, 'Toggle split/stacked')
        .map('b', actions.toggleGitReviewBase, 'Review vs base')
        .map('t', actions.toggleGitFileListMode, 'Toggle flat/tree')
        .map('T', actions.toggleTreeCompaction, 'Toggle tree compaction')
        .map(']', actions.shiftGitHeadOffset(-1), 'Newer commit')
        .map('[', actions.shiftGitHeadOffset(1), 'Older commit')
        .map('?', actions.helpModal('git-mode'), 'Help')
        .map('<Esc>', actions.exitGitMode, 'Exit git')
        .map('j', actions.selectGitFile(1), 'Next entry')
        .map('k', actions.selectGitFile(-1), 'Prev entry')
        .map('<C-n>', actions.selectGitFileOnly(1), 'Next file')
        .map('<C-p>', actions.selectGitFileOnly(-1), 'Prev file')
        .map('h', actions.toggleSelectedGitFolder, 'Toggle folder')
        .map('l', actions.toggleSelectedGitFolder, 'Toggle folder')
        .map('<C-d>', actions.scrollGitDiff(20), 'Page down')
        .map('<BS>', actions.resizeGitDiffPane(-0.05), 'File bar narrower')
        .map('<C-h>', actions.resizeGitDiffPane(-0.05), 'File bar narrower')
        .map('<C-l>', actions.resizeGitDiffPane(0.05), 'File bar wider')
        .map('<C-u>', actions.scrollGitDiff(-20), 'Page up')
        .map('<Left>', actions.collapseGitSelection, 'Collapse folder')
        .map('<Right>', actions.expandGitSelection, 'Expand folder')
        .map('<Down>', actions.scrollGitDiff(1), 'Scroll down')
        .map('<Up>', actions.scrollGitDiff(-1), 'Scroll up')
    )

    // -----------------------------------------------------------------------
    // Settings screen
    //
    // One list, sections included, so every key here moves a single cursor:
    // `j`/`k` a row, `}`/`{` a section, `/` searches the same list from a
    // picker.
    //
    // The two axes are the whole grammar: across a row changes its value —
    // `h`/`l`, the arrows and -/+ all drag the gauge, step the enum, set the
    // checkbox — and <CR> hands over to a field for the value you would rather
    // type than aim at. Nothing here is a column any more, which is what freed
    // `h`/`l` to mean what they read like.
    // -----------------------------------------------------------------------
    .mode('settings', (m) =>
      m
        .map('<Esc>', actions.exitSettings, 'Close settings')
        .map('<Leader>,', actions.exitSettings, 'Close settings')
        .map('<CR>', actions.activateSettingsRow, 'Change, or type a value')
        .map('<Space>', actions.activateSettingsRow, 'Change')
        .map('j', actions.moveSettingsSelection(1), 'Next', { repeatable: true })
        .map('k', actions.moveSettingsSelection(-1), 'Prev', { repeatable: true })
        .map('<Down>', actions.moveSettingsSelection(1), undefined, { repeatable: true })
        .map('<Up>', actions.moveSettingsSelection(-1), undefined, { repeatable: true })
        .map('<C-n>', actions.moveSettingsSelection(1))
        .map('<C-p>', actions.moveSettingsSelection(-1))
        .map('}', actions.jumpSettingsSection(1), 'Next section', { repeatable: true })
        .map('{', actions.jumpSettingsSection(-1), 'Prev section', { repeatable: true })
        .map('l', actions.adjustSettingsRow(1), 'Increase', { repeatable: true })
        .map('<Right>', actions.adjustSettingsRow(1), undefined, { repeatable: true })
        .map('+', actions.adjustSettingsRow(1), undefined, { repeatable: true })
        .map('h', actions.adjustSettingsRow(-1), 'Decrease', { repeatable: true })
        .map('<Left>', actions.adjustSettingsRow(-1), undefined, { repeatable: true })
        .map('-', actions.adjustSettingsRow(-1), undefined, { repeatable: true })
        .map('r', actions.resetSettingsRow, 'Reset to default')
        .map('/', actions.openSettingsSearch, 'Search settings')
        .map('?', actions.helpModal('settings'), 'Help')
    )

    // -----------------------------------------------------------------------
    // Modal: help (always in filter mode via Picker)
    // -----------------------------------------------------------------------
    .mode('modal.help.filtering', (m) =>
      m
        .map('<Esc>', actions.closeOverlayModal, 'Close')
        .map('<C-n>', actions.moveModalSelection(1), 'Next')
        .map('<C-p>', actions.moveModalSelection(-1), 'Prev')
        .map('<Down>', actions.moveModalSelection(1))
        .map('<Up>', actions.moveModalSelection(-1))
        .passthrough()
    )

    // -----------------------------------------------------------------------
    // Modal: theme-picker (always in filter mode via Picker)
    // -----------------------------------------------------------------------
    .mode('modal.theme-picker.filtering', (m) =>
      m
        .map('<Esc>', actions.restoreTheme, 'Cancel')
        .map('<C-n>', actions.previewTheme(1), 'Next')
        .map('<C-p>', actions.previewTheme(-1), 'Prev')
        .map('<Down>', actions.previewTheme(1))
        .map('<Up>', actions.previewTheme(-1))
        .map('<CR>', actions.confirmTheme, 'Confirm')
        .map('<C-t>', actions.toggleTransparent, 'Toggle transparent')
        .map('<C-l>', actions.toggleMode, 'Toggle light/dark')
        .passthrough()
    )

    // -----------------------------------------------------------------------
    // Stats screen (read-only)
    //
    // `h`/`l` change page and `j`/`k` scroll it — the same split the settings
    // screen uses, where the horizontal pair never touches content.
    // -----------------------------------------------------------------------
    .mode('stats', (m) =>
      m
        .map('<Esc>', actions.exitStats, 'Close stats')
        .map('<Leader>u', actions.exitStats, 'Close stats')
        .map('l', actions.moveStatsPage(1), 'Next page')
        .map('h', actions.moveStatsPage(-1), 'Prev page')
        .map('<Right>', actions.moveStatsPage(1))
        .map('<Left>', actions.moveStatsPage(-1))
        .map('j', actions.scrollStats(1), 'Scroll down', { repeatable: true })
        .map('k', actions.scrollStats(-1), 'Scroll up', { repeatable: true })
        .map('<Down>', actions.scrollStats(1), undefined, { repeatable: true })
        .map('<Up>', actions.scrollStats(-1), undefined, { repeatable: true })
        .map('<C-d>', actions.scrollStats(10), 'Page down')
        .map('<C-u>', actions.scrollStats(-10), 'Page up')
        .map('?', actions.helpModal('stats'), 'Help')
    )

    // -----------------------------------------------------------------------
    // Modal: quotas (read-only — the status bar indicator, expanded)
    // -----------------------------------------------------------------------
    .mode('modal.quotas', (m) => m.map('<Esc>', actions.closeModal, 'Close'))

    // -----------------------------------------------------------------------
    // Modal: update-available
    // -----------------------------------------------------------------------
    .mode('modal.update-available', (m) =>
      m
        .map('<Esc>', actions.closeModal, 'Cancel')
        .map('l', actions.moveModalSelection(1), 'Next')
        .map('h', actions.moveModalSelection(-1), 'Prev')
        .map('<Right>', actions.moveModalSelection(1))
        .map('<Left>', actions.moveModalSelection(-1))
        .map('<Down>', actions.moveModalSelection(1))
        .map('<Up>', actions.moveModalSelection(-1))
        .map('<C-n>', actions.moveModalSelection(1))
        .map('<C-p>', actions.moveModalSelection(-1))
        .map('<CR>', actions.confirmUpdateSelection, 'Confirm')
    )

    // -----------------------------------------------------------------------
    // Modal: workspace-move
    // -----------------------------------------------------------------------
    .mode('modal.workspace-move', (m) =>
      m
        .map('<Esc>', actions.closeModal, 'Cancel')
        .map('j', actions.moveModalSelection(1), 'Next')
        .map('k', actions.moveModalSelection(-1), 'Prev')
        .map('<Down>', actions.moveModalSelection(1))
        .map('<Up>', actions.moveModalSelection(-1))
        .map('<C-n>', actions.moveModalSelection(1))
        .map('<C-p>', actions.moveModalSelection(-1))
        .map('d', actions.toggleWorkspaceMoveDelete, 'Toggle delete source')
        .map('<CR>', actions.confirmWorkspaceMove, 'Move')
    )

    // -----------------------------------------------------------------------
    // Modal: workspace-move recoverable-failure confirmation (stash / conflicts)
    // -----------------------------------------------------------------------
    .mode('modal.workspace-move-confirm', (m) =>
      m
        .map('<Esc>', actions.closeModal, 'Cancel')
        .map('n', actions.closeModal, 'Cancel')
        .map('<CR>', actions.confirmWorkspaceMoveRetry, 'Confirm')
        .map('y', actions.confirmWorkspaceMoveRetry, 'Confirm')
    )

    // -----------------------------------------------------------------------
    // Modal: standalone workspace delete confirmation (sidebar "Remove workspace")
    // -----------------------------------------------------------------------
    .mode('modal.workspace-delete-confirm', (m) =>
      m
        .map('<Esc>', actions.closeModal, 'Cancel')
        .map('n', actions.closeModal, 'Cancel')
        .map('<CR>', actions.confirmWorkspaceDeleteModal, 'Delete workspace')
        .map('y', actions.confirmWorkspaceDeleteModal, 'Delete workspace')
    )

    // -----------------------------------------------------------------------
    // Modal: flash-jump (flash.nvim-style label jump)
    // -----------------------------------------------------------------------
    .mode('modal.flash-jump', (m) =>
      m
        .map('<Esc>', actions.closeModal, 'Cancel')
        .map('<Space>', actions.closeModal, 'Cancel')
        .passthrough()
    )

    // -----------------------------------------------------------------------
    // Modal: rename-tab
    // -----------------------------------------------------------------------
    .mode('modal.rename-tab', (m) =>
      m
        .map('<Esc>', actions.closeModal, 'Cancel')
        .map('<CR>', actions.confirmRenameTab, 'Confirm')
        .passthrough()
    )

    // -----------------------------------------------------------------------
    // Modal: search every setting (always filtering, like the other pickers)
    // -----------------------------------------------------------------------
    .mode('modal.settings-search.filtering', (m) =>
      m
        .map('<Esc>', actions.closeSettingsModal, 'Close')
        .map('<CR>', actions.confirmSettingsSearch, 'Go to setting')
        .map('<C-n>', actions.moveModalSelection(1), 'Next')
        .map('<C-p>', actions.moveModalSelection(-1), 'Prev')
        .map('<Down>', actions.moveModalSelection(1))
        .map('<Up>', actions.moveModalSelection(-1))
        .passthrough()
    )

    // -----------------------------------------------------------------------
    // Modal: one text field over a settings row
    // -----------------------------------------------------------------------
    .mode('modal.setting-text', (m) =>
      m
        .map('<Esc>', actions.closeSettingsModal, 'Cancel')
        .map('<CR>', actions.confirmSettingText, 'Confirm')
        .passthrough()
    )

    // -----------------------------------------------------------------------
    // Modal: rename-workspace
    // -----------------------------------------------------------------------
    .mode('modal.rename-workspace', (m) =>
      m
        .map('<Esc>', actions.closeModal, 'Cancel')
        .map('<CR>', actions.confirmRenameWorkspace, 'Confirm')
        .passthrough()
    )

    // -----------------------------------------------------------------------
    // Modal: new-tab (always in filter mode via Picker)
    // -----------------------------------------------------------------------
    .mode('modal.new-tab.command-edit', (m) =>
      m
        .map('<Esc>', actions.cancelNewTabModal, 'Cancel')
        .map('<CR>', actions.launchSelectedAssistant, 'Launch')
        .map('<C-n>', actions.moveModalSelection(1), 'Next')
        .map('<C-p>', actions.moveModalSelection(-1), 'Prev')
        .map('<Down>', actions.moveModalSelection(1))
        .map('<Up>', actions.moveModalSelection(-1))
        .map('<C-e>', actions.editSelectedAssistant, 'Edit')
        .passthrough()
    )

    .mode('modal.new-tab.editing-command', (m) =>
      m
        .map('<Esc>', actions.cancelEditCustomCommand, 'Cancel')
        .map('<CR>', actions.saveCustomCommand, 'Save')
        .passthrough()
    )

    // -----------------------------------------------------------------------
    // Modal: project-picker (always in filter mode via Picker)
    // -----------------------------------------------------------------------
    .mode('modal.project-picker.filtering', (m) =>
      m
        .map('<Esc>', actions.projectPickerEscape, 'Cancel')
        .map('<CR>', actions.confirmSelectedProject, 'Open')
        .map('<C-n>', actions.moveModalSelection(1), 'Next')
        .map('<C-p>', actions.moveModalSelection(-1), 'Prev')
        .map('<Down>', actions.moveModalSelection(1))
        .map('<Up>', actions.moveModalSelection(-1))
        .passthrough()
    )

    // -----------------------------------------------------------------------
    // Modal: project-name
    // -----------------------------------------------------------------------
    .mode('modal.project-name', (m) =>
      m
        .map('<Esc>', actions.backToProjectPicker, 'Cancel')
        .map('<CR>', actions.confirmProjectRename, 'Confirm')
        .passthrough()
    )

    // -----------------------------------------------------------------------
    // Modal: create-project
    // -----------------------------------------------------------------------
    .mode('modal.create-project', (m) =>
      m
        .map('<Esc>', actions.createProjectEscape, 'Cancel')
        .map('<Tab>', actions.switchField, 'Next field')
        .map('<CR>', actions.confirmCreateProject, 'Confirm')
        .map('<C-n>', actions.moveModalSelection(1), 'Next')
        .map('<C-p>', actions.moveModalSelection(-1), 'Prev')
        .map('<Down>', actions.moveModalSelection(1))
        .map('<Up>', actions.moveModalSelection(-1))
        .passthrough()
    )

    // -----------------------------------------------------------------------
    // Modal: create-workspace (a project inside the current project)
    // -----------------------------------------------------------------------
    .mode('modal.create-workspace', (m) =>
      m
        .map('<Esc>', actions.createWorkspaceEscape, 'Back/Cancel')
        .map('<Tab>', actions.switchCreateWorkspaceField, 'Next field')
        .map('<CR>', actions.confirmCreateWorkspace, 'Create')
        .map('<C-CR>', actions.createWorkspaceNewline, 'Newline')
        .map('<C-n>', actions.moveModalSelection(1), 'Next')
        .map('<C-p>', actions.moveModalSelection(-1), 'Prev')
        .map('<Down>', actions.moveModalSelection(1))
        .map('<Up>', actions.moveModalSelection(-1))
        .passthrough()
    )

    // -----------------------------------------------------------------------
    // Modal: snippet-picker (always in filter mode via Picker)
    // -----------------------------------------------------------------------
    .mode('modal.snippet-picker.filtering', (m) =>
      m
        .map('<Esc>', actions.closeModal, 'Cancel')
        .map('<CR>', actions.snippetFilterPaste, 'Send')
        .map('<C-a>', actions.snippetFilterPasteToGroup, 'Send to group')
        .map('<C-n>', actions.moveModalSelection(1), 'Next')
        .map('<C-p>', actions.moveModalSelection(-1), 'Prev')
        .map('<C-o>', actions.openSelectedSnippetSourceInEditor, 'Open source file')
        .map('<Down>', actions.moveModalSelection(1))
        .map('<Up>', actions.moveModalSelection(-1))
        .passthrough()
    )

    // -----------------------------------------------------------------------
    // Modal: snippet-editor
    // -----------------------------------------------------------------------
    .mode('modal.snippet-editor', (m) =>
      m
        .map('<Esc>', actions.backToSnippetPicker, 'Cancel')
        .map('<Tab>', actions.switchField, 'Next field')
        .map('<CR>', actions.saveSnippetEditor, 'Save')
        .map('<C-n>', actions.moveModalSelection(1), 'Next')
        .map('<C-p>', actions.moveModalSelection(-1), 'Prev')
        .map('<Down>', actions.moveModalSelection(1))
        .map('<Up>', actions.moveModalSelection(-1))
        .passthrough()
    )

    // -----------------------------------------------------------------------
    // Modal: split-picker
    // -----------------------------------------------------------------------
    .mode('modal.split-picker', (m) =>
      m
        .map('<Esc>', actions.closeModal, 'Cancel')
        .map('<Down>', actions.moveModalSelection(1), 'Next')
        .map('<Up>', actions.moveModalSelection(-1), 'Prev')
        .map('<C-n>', actions.moveModalSelection(1))
        .map('<C-p>', actions.moveModalSelection(-1))
        .map('<CR>', actions.confirmSplit, 'Confirm')
        .passthrough()
    )

    // -----------------------------------------------------------------------
    // Modal: git-commit
    // -----------------------------------------------------------------------
    .mode('modal.git-commit', (m) =>
      m
        .map('<Esc>', actions.gitCommitCancel, 'Cancel')
        .map('<C-CR>', actions.gitCommitSubmit, 'Commit')
        .map('<C-a>', actions.gitCommitEnterConfirm, 'Auto-commit (stage all)')
        .map('<Tab>', actions.switchField, 'Next field')
        .map('<CR>', actions.gitCommitReturnKey, 'Newline / confirm')
        .passthrough()
    )

    // -----------------------------------------------------------------------
    // Modal: git-commit confirm (auto-commit stage all + commit)
    // -----------------------------------------------------------------------
    .mode('modal.git-commit.confirm', (m) =>
      m
        .map('<Esc>', actions.gitCommitLeaveConfirm, 'Cancel auto-commit')
        .map('<CR>', actions.gitCommitAutoAccept, 'Stage all + commit')
        .map('<C-CR>', actions.gitCommitAutoAccept, 'Stage all + commit')
        .map('<Tab>', actions.switchField, 'Next field')
        .passthrough()
    )

    // -----------------------------------------------------------------------
    // Modal: git-commit generating (waiting for LLM)
    // -----------------------------------------------------------------------
    .mode('modal.git-commit.generating', (m) =>
      m.map('<Esc>', actions.gitCommitLeaveGenerating, 'Cancel generation')
    )

  return kb._build()
}

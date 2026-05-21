import type { AutoCommitConfig, MultiRepoConfig, ResolvedKeymapConfig } from './types'

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
        .map('<C-g>', actions.sessionPicker, 'Session picker')
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
        .map('J', actions.reorderTab(1), 'Move tab right')
        .map('j', actions.nextTab, 'Next tab')
        .map('K', actions.reorderTab(-1), 'Move tab left')
        .map('k', actions.prevTab, 'Prev tab')
        .map('r', actions.renameTab, 'Rename tab')
        .map('i', actions.enterInsert, 'Focus terminal')
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
    // Session bar: same chords from nav and while typing in the terminal
    // -----------------------------------------------------------------------
    .mode(['navigation', 'terminal-input'], (m) =>
      m
        .map('<Leader>b', actions.toggleSessionBar, 'Toggle session bar')
        .map('<Leader>u', actions.toggleAIUsage, 'Toggle AI usage')
        .map('<Leader>1', actions.switchSessionByIndex(1), 'Session 1')
        .map('<Leader>2', actions.switchSessionByIndex(2), 'Session 2')
        .map('<Leader>3', actions.switchSessionByIndex(3), 'Session 3')
        .map('<Leader>4', actions.switchSessionByIndex(4), 'Session 4')
        .map('<Leader>5', actions.switchSessionByIndex(5), 'Session 5')
        .map('<Leader>6', actions.switchSessionByIndex(6), 'Session 6')
        .map('<Leader>7', actions.switchSessionByIndex(7), 'Session 7')
        .map('<Leader>8', actions.switchSessionByIndex(8), 'Session 8')
        .map('<Leader>9', actions.switchSessionByIndex(9), 'Session 9')
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
        .map('p', actions.gitPush, 'Push')
        .map('v', actions.toggleGitDiffView, 'Toggle split/stacked')
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
    // Modal: ai-usage (info-only)
    // -----------------------------------------------------------------------
    .mode('modal.ai-usage', (m) =>
      m.map('<Esc>', actions.closeModal, 'Close').map('<Leader>u', actions.toggleAIUsage, 'Close')
    )

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
    // Modal: rename-tab
    // -----------------------------------------------------------------------
    .mode('modal.rename-tab', (m) =>
      m
        .map('<Esc>', actions.closeModal, 'Cancel')
        .map('<CR>', actions.confirmRenameTab, 'Confirm')
        .passthrough()
    )

    // -----------------------------------------------------------------------
    // Modal: new-tab (always in filter mode via Picker)
    // -----------------------------------------------------------------------
    .mode('modal.new-tab.command-edit', (m) =>
      m
        .map('<Esc>', actions.closeModal, 'Cancel')
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
    // Modal: session-picker (always in filter mode via Picker)
    // -----------------------------------------------------------------------
    .mode('modal.session-picker.filtering', (m) =>
      m
        .map('<Esc>', actions.sessionPickerEscape, 'Cancel')
        .map('<CR>', actions.confirmSelectedSession, 'Open')
        .map('<C-n>', actions.moveModalSelection(1), 'Next')
        .map('<C-p>', actions.moveModalSelection(-1), 'Prev')
        .map('<Down>', actions.moveModalSelection(1))
        .map('<Up>', actions.moveModalSelection(-1))
        .passthrough()
    )

    // -----------------------------------------------------------------------
    // Modal: session-name
    // -----------------------------------------------------------------------
    .mode('modal.session-name', (m) =>
      m
        .map('<Esc>', actions.backToSessionPicker, 'Cancel')
        .map('<CR>', actions.confirmSessionRename, 'Confirm')
        .passthrough()
    )

    // -----------------------------------------------------------------------
    // Modal: create-session
    // -----------------------------------------------------------------------
    .mode('modal.create-session', (m) =>
      m
        .map('<Esc>', actions.createSessionEscape, 'Cancel')
        .map('<Tab>', actions.switchField, 'Next field')
        .map('<CR>', actions.confirmCreateSession, 'Confirm')
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

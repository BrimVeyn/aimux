import type { ResolvedKeymapConfig } from './types'

import * as actions from './actions'
import { KeymapBuilder } from './keymap-builder'

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
        .map('G', actions.toggleGitPanel, 'Toggle git panel')
        .map('<C-d>', actions.enterGitMode, 'Enter git mode')
        .map('<C-j>', actions.resizeGitPanel(-0.05), 'Git panel smaller')
        .map('<C-k>', actions.resizeGitPanel(0.05), 'Git panel larger')
        .map('J', actions.reorderTab(1), 'Move tab right')
        .map('j', actions.nextTab, 'Next tab')
        .map('K', actions.reorderTab(-1), 'Move tab left')
        .map('k', actions.prevTab, 'Prev tab')
        .map('r', actions.renameTab, 'Rename tab')
        .map('i', actions.enterInsert, 'Focus terminal')
        .map('?', actions.helpModal, 'Help')
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
        .map('<Esc>', actions.exitGitMode, 'Exit git')
        .map('j', actions.selectGitFile(1), 'Next file')
        .map('k', actions.selectGitFile(-1), 'Prev file')
        .map('<C-d>', actions.scrollGitDiff(20), 'Page down')
        .map('<C-u>', actions.scrollGitDiff(-20), 'Page up')
        .map('<Down>', actions.scrollGitDiff(1), 'Scroll down')
        .map('<Up>', actions.scrollGitDiff(-1), 'Scroll up')
        .map('a', actions.gitStageSelected, 'Stage')
        .map('d', actions.gitDestructiveSelected, 'Unstage/delete')
        .map('c', actions.gitCommitOpen, 'Commit')
        .map('p', actions.gitPush, 'Push')
    )

    // -----------------------------------------------------------------------
    // Modal: help
    // -----------------------------------------------------------------------
    .mode('modal.help', (m) => m.map('<Esc>', actions.closeModal, 'Close'))

    // -----------------------------------------------------------------------
    // Modal: theme-picker
    // -----------------------------------------------------------------------
    .mode('modal.theme-picker', (m) =>
      m
        .map('<Esc>', actions.restoreTheme, 'Cancel')
        .map('j', actions.previewTheme(1), 'Next')
        .map('k', actions.previewTheme(-1), 'Prev')
        .map('<Down>', actions.previewTheme(1))
        .map('<Up>', actions.previewTheme(-1))
        .map('<CR>', actions.confirmTheme, 'Confirm')
    )

    // -----------------------------------------------------------------------
    // Modal: update-available
    // -----------------------------------------------------------------------
    .mode('modal.update-available', (m) =>
      m
        .map('<Esc>', actions.closeModal, 'Cancel')
        .map('l', actions.moveModalSelection(1), 'Next')
        .map('h', actions.moveModalSelection(-1), 'Prev')
        .map('j', actions.moveModalSelection(1))
        .map('k', actions.moveModalSelection(-1))
        .map('<Right>', actions.moveModalSelection(1))
        .map('<Left>', actions.moveModalSelection(-1))
        .map('<Down>', actions.moveModalSelection(1))
        .map('<Up>', actions.moveModalSelection(-1))
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
    // Modal: new-tab
    // -----------------------------------------------------------------------
    .mode('modal.new-tab', (m) =>
      m
        .map('<Esc>', actions.closeModal, 'Cancel')
        .map('j', actions.moveModalSelection(1), 'Next')
        .map('k', actions.moveModalSelection(-1), 'Prev')
        .map('<Down>', actions.moveModalSelection(1))
        .map('<Up>', actions.moveModalSelection(-1))
        .map('<CR>', actions.launchSelectedAssistant, 'Launch')
        .map('e', actions.beginCommandEdit, 'Edit command')
    )

    // -----------------------------------------------------------------------
    // Modal: new-tab command-edit
    // -----------------------------------------------------------------------
    .mode('modal.new-tab.command-edit', (m) =>
      m
        .map('<Esc>', actions.cancelCommandEdit('modal.new-tab'), 'Cancel')
        .map('<CR>', actions.commitCommandEdit, 'Save')
        .map('<C-n>', actions.moveModalSelection(1), 'Next')
        .map('<C-p>', actions.moveModalSelection(-1), 'Prev')
        .passthrough()
    )

    // -----------------------------------------------------------------------
    // Modal: session-picker
    // -----------------------------------------------------------------------
    .mode('modal.session-picker', (m) =>
      m
        .map('<Esc>', actions.sessionPickerEscape, 'Cancel')
        .map('j', actions.moveModalSelection(1), 'Next')
        .map('k', actions.moveModalSelection(-1), 'Prev')
        .map('<Down>', actions.moveModalSelection(1))
        .map('<Up>', actions.moveModalSelection(-1))
        .map('<CR>', actions.confirmSelectedSession, 'Open')
        .map('n', actions.openCreateSessionModal, 'New')
        .map('r', actions.openRenameSelectedSession, 'Rename')
        .map('d', actions.deleteSelectedSession, 'Delete')
        .map('/', actions.beginSessionFilter, 'Filter')
    )

    // -----------------------------------------------------------------------
    // Modal: session-picker filtering
    // -----------------------------------------------------------------------
    .mode('modal.session-picker.filtering', (m) =>
      m
        .map('<Esc>', actions.cancelCommandEdit('modal.session-picker'), 'Cancel')
        .map('<CR>', actions.confirmSelectedSession, 'Open')
        .map('<C-n>', actions.moveModalSelection(1), 'Next')
        .map('<C-p>', actions.moveModalSelection(-1), 'Prev')
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
        .map('<Esc>', actions.backToSessionPicker, 'Cancel')
        .map('<Tab>', actions.switchField, 'Next field')
        .map('<CR>', actions.confirmCreateSession, 'Confirm')
        .map('<C-n>', actions.moveModalSelection(1), 'Next')
        .map('<C-p>', actions.moveModalSelection(-1), 'Prev')
        .passthrough()
    )

    // -----------------------------------------------------------------------
    // Modal: snippet-picker
    // -----------------------------------------------------------------------
    .mode('modal.snippet-picker', (m) =>
      m
        .map('<Esc>', actions.closeModal, 'Cancel')
        .map('j', actions.moveModalSelection(1), 'Next')
        .map('k', actions.moveModalSelection(-1), 'Prev')
        .map('<Down>', actions.moveModalSelection(1))
        .map('<Up>', actions.moveModalSelection(-1))
        .map('<CR>', actions.pasteSelectedSnippet, 'Send')
        .map('a', actions.pasteSnippetToGroup, 'Send to group')
        .map('n', actions.openSnippetEditor, 'New')
        .map('r', actions.editSelectedSnippet, 'Edit')
        .map('e', actions.editSelectedSnippet)
        .map('d', actions.deleteSelectedSnippet, 'Delete')
        .map('/', actions.beginSnippetFilter, 'Filter')
    )

    // -----------------------------------------------------------------------
    // Modal: snippet-picker filtering
    // -----------------------------------------------------------------------
    .mode('modal.snippet-picker.filtering', (m) =>
      m
        .map('<Esc>', actions.cancelCommandEdit('modal.snippet-picker'), 'Cancel')
        .map('<CR>', actions.snippetFilterPaste, 'Send')
        .map('<C-a>', actions.snippetFilterPasteToGroup, 'Send to group')
        .map('<C-n>', actions.moveModalSelection(1), 'Next')
        .map('<C-p>', actions.moveModalSelection(-1), 'Prev')
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
        .passthrough()
    )

    // -----------------------------------------------------------------------
    // Modal: split-picker
    // -----------------------------------------------------------------------
    .mode('modal.split-picker', (m) =>
      m
        .map('<Esc>', actions.closeModal, 'Cancel')
        .map('j', actions.moveModalSelection(1), 'Next')
        .map('k', actions.moveModalSelection(-1), 'Prev')
        .map('<Down>', actions.moveModalSelection(1))
        .map('<Up>', actions.moveModalSelection(-1))
        .map('<CR>', actions.confirmSplit, 'Confirm')
    )

    // -----------------------------------------------------------------------
    // Modal: git-commit
    // -----------------------------------------------------------------------
    .mode('modal.git-commit', (m) =>
      m
        .map('<Esc>', actions.gitCommitCancel, 'Cancel')
        .map('<C-CR>', actions.gitCommitSubmit, 'Commit')
        .map('<Tab>', actions.switchField, 'Next field')
        .map('<CR>', actions.gitCommitReturnKey, 'Newline / confirm')
        .passthrough()
    )

  return kb._build()
}

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
    // Navigation mode (src/input/modes/handlers/navigation.ts)
    // -----------------------------------------------------------------------
    .mode('navigation', (m) =>
      m
        .map('<C-c>', actions.quit)
        .map('<C-n>', actions.newTab)
        .map('<C-g>', actions.sessionPicker)
        .map('<C-z>', actions.ctrlZSidebar)
        .map('dd', actions.closeTab)
        .map('<C-b>', actions.toggleSidebar)
        .map('<C-r>', actions.restartTab)
        .map('<C-s>', actions.snippetPicker)
        .map('<C-t>', actions.themePicker)
        .map('<C-h>', actions.resizeSidebar(-2))
        .map('<C-l>', actions.resizeSidebar(2))
        .map('G', actions.toggleGitPanel)
        .map('<C-d>', actions.enterGitMode)
        .map('<C-j>', actions.resizeGitPanel(-0.05))
        .map('<C-k>', actions.resizeGitPanel(0.05))
        .map('J', actions.reorderTab(1))
        .map('j', actions.nextTab)
        .map('K', actions.reorderTab(-1))
        .map('k', actions.prevTab)
        .map('r', actions.renameTab)
        .map('i', actions.enterInsert)
        .map('?', actions.helpModal)
    )

    // -----------------------------------------------------------------------
    // Terminal-input mode
    // Bindings here are processed by raw-input-handler.ts before bytes reach
    // the PTY. Only single-chord <C-*> sequences are supported (no multi-key).
    // -----------------------------------------------------------------------
    .mode('terminal-input', (m) =>
      m
        .map('<C-z>', actions.leaveTerminalInput)
        .map('<Leader>', actions.enterLayoutMode)
        .map('<C-b>', actions.toggleSidebarFromInput)
    )

    // -----------------------------------------------------------------------
    // Layout mode (src/input/modes/handlers/layout.ts)
    // -----------------------------------------------------------------------
    .mode('layout', (m) =>
      m
        .map('<Esc>', actions.exitLayoutToInput)
        .map('<Leader>', actions.exitLayoutToInput)
        .map('<C-z>', actions.exitLayoutToNavigation)
        .map('H', actions.resizePane(-1, 'vertical'))
        .map('L', actions.resizePane(1, 'vertical'))
        .map('K', actions.resizePane(-1, 'horizontal'))
        .map('J', actions.resizePane(1, 'horizontal'))
        .map('h', actions.focusPane('left'))
        .map('j', actions.focusPane('down'))
        .map('k', actions.focusPane('up'))
        .map('l', actions.focusPane('right'))
        .map('|', actions.splitVertical)
        .map('-', actions.splitHorizontal)
        .map('q', actions.closePane)
    )

    // -----------------------------------------------------------------------
    // Git mode (src/input/modes/handlers/git-mode.ts)
    // -----------------------------------------------------------------------
    .mode('git-mode', (m) =>
      m
        .map('<Esc>', actions.exitGitMode)
        .map('j', actions.selectGitFile(1))
        .map('k', actions.selectGitFile(-1))
        .map('<C-d>', actions.scrollGitDiff(20))
        .map('<C-u>', actions.scrollGitDiff(-20))
        .map('<Down>', actions.scrollGitDiff(1))
        .map('<Up>', actions.scrollGitDiff(-1))
        .map('a', actions.gitStageSelected)
        .map('d', actions.gitDestructiveSelected)
        .map('c', actions.gitCommitOpen)
        .map('p', actions.gitPush)
    )

    // -----------------------------------------------------------------------
    // Modal: help (src/input/modes/handlers/modal-help.ts)
    // -----------------------------------------------------------------------
    .mode('modal.help', (m) => m.map('<Esc>', actions.closeModal))

    // -----------------------------------------------------------------------
    // Modal: theme-picker (src/input/modes/handlers/modal-theme-picker.ts)
    // -----------------------------------------------------------------------
    .mode('modal.theme-picker', (m) =>
      m
        .map('<Esc>', actions.restoreTheme)
        .map('j', actions.previewTheme(1))
        .map('k', actions.previewTheme(-1))
        .map('<Down>', actions.previewTheme(1))
        .map('<Up>', actions.previewTheme(-1))
        .map('<CR>', actions.confirmTheme)
    )

    // -----------------------------------------------------------------------
    // Modal: rename-tab (src/input/modes/handlers/modal-rename-tab.ts)
    // -----------------------------------------------------------------------
    .mode('modal.rename-tab', (m) =>
      m.map('<Esc>', actions.closeModal).map('<CR>', actions.confirmRenameTab).passthrough()
    )

    // -----------------------------------------------------------------------
    // Modal: new-tab (src/input/modes/handlers/modal-new-tab.ts)
    // -----------------------------------------------------------------------
    .mode('modal.new-tab', (m) =>
      m
        .map('<Esc>', actions.closeModal)
        .map('j', actions.moveModalSelection(1))
        .map('k', actions.moveModalSelection(-1))
        .map('<Down>', actions.moveModalSelection(1))
        .map('<Up>', actions.moveModalSelection(-1))
        .map('<CR>', actions.launchSelectedAssistant)
        .map('e', actions.beginCommandEdit)
    )

    // -----------------------------------------------------------------------
    // Modal: new-tab command-edit
    // (src/input/modes/handlers/modal-new-tab-command-edit.ts)
    // -----------------------------------------------------------------------
    .mode('modal.new-tab.command-edit', (m) =>
      m
        .map('<Esc>', actions.cancelCommandEdit('modal.new-tab'))
        .map('<CR>', actions.commitCommandEdit)
        .map('<C-n>', actions.moveModalSelection(1))
        .map('<C-p>', actions.moveModalSelection(-1))
        .passthrough()
    )

    // -----------------------------------------------------------------------
    // Modal: session-picker (src/input/modes/handlers/modal-session-picker.ts)
    // -----------------------------------------------------------------------
    .mode('modal.session-picker', (m) =>
      m
        .map('<Esc>', actions.sessionPickerEscape)
        .map('j', actions.moveModalSelection(1))
        .map('k', actions.moveModalSelection(-1))
        .map('<Down>', actions.moveModalSelection(1))
        .map('<Up>', actions.moveModalSelection(-1))
        .map('<CR>', actions.confirmSelectedSession)
        .map('n', actions.openCreateSessionModal)
        .map('r', actions.openRenameSelectedSession)
        .map('d', actions.deleteSelectedSession)
        .map('/', actions.beginSessionFilter)
    )

    // -----------------------------------------------------------------------
    // Modal: session-picker filtering
    // (src/input/modes/handlers/modal-session-picker-filter.ts)
    // -----------------------------------------------------------------------
    .mode('modal.session-picker.filtering', (m) =>
      m
        .map('<Esc>', actions.cancelCommandEdit('modal.session-picker'))
        .map('<CR>', actions.confirmSelectedSession)
        .map('<C-n>', actions.moveModalSelection(1))
        .map('<C-p>', actions.moveModalSelection(-1))
        .passthrough()
    )

    // -----------------------------------------------------------------------
    // Modal: session-name (src/input/modes/handlers/modal-session-name.ts)
    // -----------------------------------------------------------------------
    .mode('modal.session-name', (m) =>
      m
        .map('<Esc>', actions.backToSessionPicker)
        .map('<CR>', actions.confirmSessionRename)
        .passthrough()
    )

    // -----------------------------------------------------------------------
    // Modal: create-session
    // (src/input/modes/handlers/modal-create-session.ts)
    // -----------------------------------------------------------------------
    .mode('modal.create-session', (m) =>
      m
        .map('<Esc>', actions.backToSessionPicker)
        .map('<Tab>', actions.switchField)
        .map('<CR>', actions.confirmCreateSession)
        .map('<C-n>', actions.moveModalSelection(1))
        .map('<C-p>', actions.moveModalSelection(-1))
        .passthrough()
    )

    // -----------------------------------------------------------------------
    // Modal: snippet-picker
    // (src/input/modes/handlers/modal-snippet-picker.ts)
    // -----------------------------------------------------------------------
    .mode('modal.snippet-picker', (m) =>
      m
        .map('<Esc>', actions.closeModal)
        .map('j', actions.moveModalSelection(1))
        .map('k', actions.moveModalSelection(-1))
        .map('<Down>', actions.moveModalSelection(1))
        .map('<Up>', actions.moveModalSelection(-1))
        .map('<CR>', actions.pasteSelectedSnippet)
        .map('a', actions.pasteSnippetToGroup)
        .map('n', actions.openSnippetEditor)
        .map('r', actions.editSelectedSnippet)
        .map('e', actions.editSelectedSnippet)
        .map('d', actions.deleteSelectedSnippet)
        .map('/', actions.beginSnippetFilter)
    )

    // -----------------------------------------------------------------------
    // Modal: snippet-picker filtering
    // (src/input/modes/handlers/modal-snippet-picker-filter.ts)
    // -----------------------------------------------------------------------
    .mode('modal.snippet-picker.filtering', (m) =>
      m
        .map('<Esc>', actions.cancelCommandEdit('modal.snippet-picker'))
        .map('<CR>', actions.snippetFilterPaste)
        .map('<C-a>', actions.snippetFilterPasteToGroup)
        .map('<C-n>', actions.moveModalSelection(1))
        .map('<C-p>', actions.moveModalSelection(-1))
        .passthrough()
    )

    // -----------------------------------------------------------------------
    // Modal: snippet-editor
    // (src/input/modes/handlers/modal-snippet-editor.ts)
    // -----------------------------------------------------------------------
    .mode('modal.snippet-editor', (m) =>
      m
        .map('<Esc>', actions.backToSnippetPicker)
        .map('<Tab>', actions.switchField)
        .map('<CR>', actions.saveSnippetEditor)
        .map('<C-n>', actions.moveModalSelection(1))
        .map('<C-p>', actions.moveModalSelection(-1))
        .passthrough()
    )

    // -----------------------------------------------------------------------
    // Modal: split-picker
    // (src/input/modes/handlers/modal-split-picker.ts)
    // -----------------------------------------------------------------------
    .mode('modal.split-picker', (m) =>
      m
        .map('<Esc>', actions.closeModal)
        .map('j', actions.moveModalSelection(1))
        .map('k', actions.moveModalSelection(-1))
        .map('<Down>', actions.moveModalSelection(1))
        .map('<Up>', actions.moveModalSelection(-1))
        .map('<CR>', actions.confirmSplit)
    )

  return kb._build()
}

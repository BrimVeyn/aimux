import type { KeyEvent } from '@opentui/core'

import type { AppAction, AppState, GitFileListMode, TabSession } from '../../state/types'

export type ModeId =
  | 'navigation'
  | 'terminal-input'
  | 'git-mode'
  | 'modal.new-tab.command-edit'
  | 'modal.new-tab.editing-command'
  | 'modal.session-picker.filtering'
  | 'modal.session-name'
  | 'modal.create-session'
  | 'modal.rename-tab'
  | 'modal.snippet-picker.filtering'
  | 'modal.snippet-editor'
  | 'modal.theme-picker.filtering'
  | 'modal.help.filtering'
  | 'modal.split-picker'
  | 'modal.git-commit'
  | 'modal.auto-commit'
  | 'modal.auto-commit.editing'
  | 'modal.update-available'

export type SideEffect =
  | { type: 'quit'; state: AppState }
  | { type: 'launch-selected-assistant' }
  | { type: 'confirm-selected-session' }
  | { type: 'delete-selected-session' }
  | { type: 'open-rename-selected-session' }
  | { type: 'create-session'; name: string; projectPath?: string }
  | { type: 'close-tab'; tabId: string }
  | { type: 'restart-tab'; tab: TabSession }
  | { type: 'paste-selected-snippet' }
  | { type: 'paste-snippet-to-group' }
  | { type: 'edit-selected-snippet' }
  | { type: 'delete-selected-snippet' }
  | { type: 'save-snippet-editor' }
  | { type: 'save-custom-command' }
  | { type: 'apply-theme'; action: 'open' }
  | { type: 'apply-theme'; action: 'restore' }
  | { type: 'apply-theme'; action: 'confirm' }
  | { type: 'apply-theme'; action: 'preview'; delta: 1 | -1 }
  | { type: 'rename-session'; sessionId: string; name: string }
  | {
      type: 'split-pane'
      direction: import('../../state/layout-tree').SplitDirection
      sourceTabId?: string
    }
  | { type: 'confirm-split' }
  | { type: 'scroll-git-diff'; delta: number }
  | { type: 'persist-git-diff-mode-ratio'; ratio: number }
  | { type: 'persist-git-file-list-mode'; mode: GitFileListMode }
  | { type: 'persist-git-tree-compaction'; enabled: boolean }
  | { type: 'git-stage'; path: string }
  | { type: 'git-unstage'; path: string }
  | { type: 'git-restore'; path: string }
  | { type: 'git-rm'; path: string }
  | { type: 'git-commit'; title: string; body: string }
  | { type: 'git-push' }
  | { type: 'auto-commit-accept'; sessionId: string; title: string; body: string }
  | { type: 'auto-commit-dismiss'; sessionId: string; title: string; body: string }
  | { type: 'confirm-update-selection' }
  | { type: 'switch-session-by-index'; index: number }
  | { type: 'delete-session'; sessionId: string }
  | { type: 'toggle-transparent' }

export interface KeyResult {
  actions: AppAction[]
  effects: SideEffect[]
  transition?: ModeId
}

export interface ModeContext {
  readonly state: AppState
}

export type KeyInput = Pick<KeyEvent, 'name' | 'ctrl' | 'meta' | 'shift' | 'sequence'>

export interface ModeHandler {
  readonly id: ModeId
  handleKey(key: KeyInput, ctx: ModeContext): KeyResult | null
  onEnter?(ctx: ModeContext, from: ModeId): KeyResult
  onExit?(ctx: ModeContext, to: ModeId): KeyResult
}

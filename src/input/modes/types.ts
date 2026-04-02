import type { KeyEvent } from '@opentui/core'

import type { AppAction, AppState, TabSession } from '../../state/types'

export type ModeId =
  | 'navigation'
  | 'terminal-input'
  | 'layout'
  | 'modal.new-tab'
  | 'modal.new-tab.command-edit'
  | 'modal.session-picker'
  | 'modal.session-picker.filtering'
  | 'modal.session-name'
  | 'modal.create-session'
  | 'modal.rename-tab'
  | 'modal.snippet-picker'
  | 'modal.snippet-picker.filtering'
  | 'modal.snippet-editor'
  | 'modal.theme-picker'
  | 'modal.help'
  | 'modal.split-picker'

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
  | { type: 'edit-selected-snippet' }
  | { type: 'delete-selected-snippet' }
  | { type: 'save-snippet-editor' }
  | { type: 'save-custom-command' }
  | { type: 'apply-theme'; action: 'open' }
  | { type: 'apply-theme'; action: 'restore' }
  | { type: 'apply-theme'; action: 'confirm' }
  | { type: 'apply-theme'; action: 'preview'; delta: 1 | -1 }
  | { type: 'rename-session'; sessionId: string; name: string }
  | { type: 'split-pane'; direction: import('../../state/layout-tree').SplitDirection }
  | { type: 'confirm-split' }

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

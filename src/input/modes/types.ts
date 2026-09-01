import type { KeyEvent } from '@opentui/core'

import type { AppAction } from '../../state/actions'
import type { SplitDirection } from '../../state/layout-tree'
import type { AppState, GitFileListMode, TabSession } from '../../state/types'

export type ModeId =
  | 'navigation'
  | 'terminal-input'
  | 'git-mode'
  | 'modal.new-tab.command-edit'
  | 'modal.new-tab.editing-command'
  | 'modal.workspace-delete-confirm'
  | 'modal.project-picker.filtering'
  | 'modal.project-name'
  | 'modal.create-project'
  | 'modal.create-workspace'
  | 'modal.rename-tab'
  | 'modal.rename-workspace'
  | 'modal.setting-text'
  | 'modal.settings-search.filtering'
  | 'modal.snippet-picker.filtering'
  | 'modal.snippet-editor'
  | 'modal.theme-picker.filtering'
  | 'modal.help.filtering'
  | 'modal.split-picker'
  | 'modal.git-commit'
  | 'modal.git-commit.confirm'
  | 'modal.git-commit.generating'
  | 'modal.update-available'
  | 'modal.workspace-move'
  | 'modal.workspace-move-confirm'
  | 'modal.flash-jump'
  | 'modal.quotas'
  | 'settings'
  | 'stats'

export type SideEffect =
  | { type: 'quit'; state: AppState }
  | { type: 'open-new-tab' }
  | { type: 'launch-selected-assistant' }
  | { type: 'edit-selected-assistant' }
  | { type: 'confirm-selected-project' }
  | { type: 'delete-selected-project' }
  | { type: 'open-rename-selected-project' }
  | { type: 'create-project'; name: string; projectPath?: string }
  | { type: 'create-workspace' }
  | { type: 'load-create-workspace-base-branches' }
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
  | { type: 'apply-theme'; action: 'preview' }
  | { type: 'rename-project'; projectId: string; name: string }
  | { type: 'rename-tab'; tabId: string; title: string }
  | {
      type: 'split-pane'
      direction: SplitDirection
      sourceTabId?: string
    }
  | { type: 'confirm-split' }
  | { type: 'scroll-git-diff'; delta: number }
  | { type: 'persist-git-diff-mode-ratio'; ratio: number }
  | { type: 'persist-git-file-list-mode'; mode: GitFileListMode }
  | { type: 'persist-git-tree-compaction'; enabled: boolean }
  | { type: 'git-stage'; path: string }
  | { type: 'git-unstage'; path: string }
  | { type: 'git-stage-all' }
  | { type: 'git-unstage-all' }
  | { type: 'git-restore'; path: string }
  | { type: 'git-rm'; path: string }
  | { type: 'git-commit'; title: string; body: string }
  | { type: 'git-commit-auto'; title: string; body: string }
  | { type: 'generate-auto-commit-now'; projectId: string }
  | { type: 'git-push' }
  | { type: 'confirm-update-selection' }
  | { type: 'switch-project-by-index'; index: number; workspaceId?: string }
  | { type: 'cycle-sidebar-item'; direction: 1 | -1 }
  | { type: 'switch-tab-by-index'; index: number }
  | { type: 'delete-project'; projectId: string }
  | {
      type: 'delete-workspace'
      projectId: string
      workspaceId: string
      // Force the git worktree removal (discards uncommitted changes in the
      // workspace). Also implies closing the workspace's tabs.
      force?: boolean
      // Close the workspace's tabs without forcing the git removal. Lets the
      // sidebar "Remove workspace" clean up tabs (avoiding orphans) while still
      // refusing to discard uncommitted work in a temp workspace.
      closeTabs?: boolean
    }
  | {
      type: 'move-workspace'
      projectId: string
      sourceWorkspaceId: string
      targetWorkspaceId: string
      deleteSource?: boolean
      // Retry flags set by the workspace-move-confirm dialog.
      stashTarget?: boolean
      keepConflicts?: boolean
    }
  | { type: 'load-workspace-move-stats' }
  | { type: 'hibernate-workspace'; workspaceId: string }
  | { type: 'toggle-transparent' }
  | { type: 'toggle-mode' }
  | { type: 'open-file-in-editor'; path: string }
  | { type: 'open-selected-snippet-source-in-editor' }
  | { type: 'run-setup' }
  | { type: 'stop-setup' }
  | { type: 'configure-setup-script'; projectId?: string }
  | { type: 'set-project-default-base-ref'; projectId: string; baseRef: string }
  | { type: 'toggle-project-collapsed'; projectId: string }
  | { type: 'ask-agent-for-setup-script' }
  | { type: 'promote-setup-tab' }
  /** Toggle a checkbox, cycle an enum, run a row's action — whatever the row is. */
  | { type: 'activate-settings-row' }
  | { type: 'adjust-settings-row'; delta: 1 | -1 }
  | { type: 'reset-settings-row' }
  | { type: 'confirm-settings-search' }
  | { type: 'commit-setting-text'; settingId: string; value: string }

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

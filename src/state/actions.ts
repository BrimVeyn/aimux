// Every action the reducer accepts, grouped by the slice of state it touches.
//
// Split from `types.ts` so the state shapes and the messages that change them
// are separate files: the shapes are read by the whole app, this union only by
// the reducer and the things that dispatch into it.

import type { ModeId } from '@brimveyn/aimux-config'

import type { LayoutNode, SplitDirection } from './layout-tree'
import type {
  AssistantId,
  BarSide,
  BranchDivergence,
  DiffData,
  DirectoryResult,
  DiscoveredRepo,
  FocusMode,
  GitFileSection,
  GitPanelError,
  GitRefreshPayload,
  PendingWorkspaceLaunch,
  ProjectRecord,
  ProjectSnapshotV1,
  ProjectStatus,
  SnippetRecord,
  TabActivity,
  TabSession,
  TerminalModeState,
  TerminalSnapshot,
  WorkspaceRecord,
} from './types'

export type ModalAction =
  | { type: 'move-modal-cursor'; delta?: number; to?: 'home' | 'end' }
  | { type: 'open-new-tab-modal'; pendingWorkspace?: PendingWorkspaceLaunch }
  | { type: 'open-edit-custom-command'; assistantId: AssistantId }
  | { type: 'open-help-modal'; scope?: ModeId }
  | { type: 'open-split-picker'; direction: SplitDirection }
  | { type: 'open-project-picker' }
  | {
      type: 'open-project-name-modal'
      projectTargetId?: string
      initialName?: string
      returnToProjectPicker?: boolean
    }
  | { type: 'close-modal' }
  | { type: 'move-modal-selection'; delta: number }
  | { type: 'update-command-edit'; char: string }
  | { type: 'cancel-command-edit' }
  | { type: 'open-create-project-modal'; returnToProjectPicker: boolean }
  | { type: 'open-create-workspace-modal' }
  | { type: 'set-create-workspace-base-branches'; branches: string[]; defaultBranch?: string }
  | { type: 'set-create-workspace-branch-error'; message: string | null }
  | { type: 'set-create-workspace-step'; step: 'form' | 'template' }
  | { type: 'switch-create-workspace-field' }
  | { type: 'set-directory-results'; results: DirectoryResult[] }
  | { type: 'switch-create-project-field' }
  | { type: 'select-directory' }
  | { type: 'open-rename-tab-modal' }
  | {
      type: 'open-rename-workspace-modal'
      projectId: string
      workspaceId: string
      initialName: string
    }
  | { type: 'open-snippet-picker' }
  | { type: 'open-snippet-editor'; snippetId?: string }
  | { type: 'set-help-entry-count'; count: number }
  | { type: 'set-theme-entry-count'; count: number }
  | { type: 'open-theme-picker' }
  | { type: 'open-update-available-modal'; currentVersion: string; latestVersion: string }
  | { type: 'set-modal-selection-index'; index: number }
  | { type: 'open-ai-usage-modal' }
  | { type: 'open-workspace-move-modal'; sourceWorkspaceId: string }
  | { type: 'toggle-workspace-move-delete' }
  | { type: 'set-workspace-move-stats'; dirtyFiles: Record<string, number> }
  | {
      type: 'open-workspace-move-confirm'
      variant: 'stash-target' | 'keep-conflicts'
      files: string[]
      projectId: string
      sourceWorkspaceId: string
      targetWorkspaceId: string
      deleteSource: boolean
      sourceLabel: string
      targetLabel: string
    }
  | {
      type: 'open-workspace-delete-confirm'
      projectId: string
      workspaceId: string
      workspaceLabel: string
      reason: string
      closeTabs: boolean
      force: boolean
    }
  | { type: 'open-flash-jump-modal' }
  | { type: 'clear-flash-jump-pending' }

export type ProjectAction =
  | {
      type: 'load-project'
      projectId: string
      projectSnapshot?: ProjectSnapshotV1
      forceDisconnected?: boolean
    }
  | { type: 'set-projects'; projects: ProjectRecord[] }
  | { type: 'create-project-record'; project: ProjectRecord }
  | { type: 'rename-project-record'; projectId: string; name: string }
  | { type: 'delete-project-record'; projectId: string; openProjectPicker?: boolean }
  | { type: 'reorder-projects'; orderedIds: string[] }
  | { type: 'reorder-active-project'; delta: number }
  | { type: 'set-project-status'; projectId: string; status: ProjectStatus }
  | {
      type: 'add-workspace-record'
      projectId: string
      workspace: WorkspaceRecord
      activate?: boolean
    }
  | { type: 'set-active-workspace'; projectId: string; workspaceId: string }
  | {
      type: 'update-workspace-record'
      projectId: string
      workspaceId: string
      patch: Partial<WorkspaceRecord>
    }

export type TabAction =
  | { type: 'add-tab'; tab: TabSession }
  | {
      type: 'hydrate-project'
      tabs: TabSession[]
      activeTabId: string | null
      layoutTree?: LayoutNode | null
      layoutTrees?: Record<string, LayoutNode>
      tabGroupMap?: Record<string, string>
    }
  | { type: 'close-tab'; tabId: string }
  | { type: 'close-active-tab' }
  | { type: 'set-active-tab'; tabId: string }
  | { type: 'move-active-tab'; delta: number }
  | { type: 'reorder-active-tab'; delta: number }
  | { type: 'reorder-tabs'; orderedTabIds: string[] }
  | { type: 'reset-tab-project'; tabId: string }
  | {
      type: 'rename-tab'
      tabId: string
      title: string
      autoRenameStatus?: 'eligible' | 'attempted'
    }
  | {
      type: 'update-tab-metadata'
      tabId: string
      title?: string
      autoRenameStatus?: 'eligible' | 'attempted'
    }
  | { type: 'append-tab-buffer'; tabId: string; chunk: string }
  | {
      type: 'replace-tab-viewport'
      tabId: string
      viewport: TerminalSnapshot
      terminalModes: TerminalModeState
      source?: 'resize' | 'scroll' | 'data' | 'switch'
    }
  | { type: 'set-tab-activity'; tabId: string; activity?: TabActivity }
  | { type: 'set-tab-error'; tabId: string; message: string }

export type LayoutAction =
  | {
      type: 'split-pane'
      direction: SplitDirection
      newTab: TabSession
    }
  | { type: 'close-pane'; tabId: string }
  | {
      type: 'focus-pane-direction'
      direction: 'left' | 'right' | 'up' | 'down'
    }
  | {
      type: 'resize-pane'
      tabId: string
      delta: number
      axis?: SplitDirection
    }
  | {
      type: 'set-split-ratio'
      tabId: string
      ratio: number
      axis?: SplitDirection
    }

export type UIAction =
  | { type: 'toggle-bar'; side: BarSide }
  | { type: 'resize-bar'; side: BarSide; delta: number }
  | { type: 'set-bar-width'; side: BarSide; width: number }
  | { type: 'toggle-widget'; widgetId: string }
  | { type: 'move-widget'; widgetId: string; side: BarSide; index: number }
  | { type: 'set-bar-boundary'; side: BarSide; index: number; ratio: number }
  | { type: 'resize-widget'; widgetId: string; delta: number }
  | { type: 'set-focus-mode'; focusMode: FocusMode }
  | { type: 'set-terminal-size'; cols: number; rows: number }
  | { type: 'resize-git-diff-pane'; delta: number }
  | { type: 'set-pending-chords'; chords: string[] | null }
  | { type: 'toggle-project-bar' }

export type GitPanelAction =
  | { type: 'git-refresh-success'; payload: GitRefreshPayload }
  | { type: 'git-refresh-error'; kind: GitPanelError }
  | { type: 'git-panel-reset' }
  | { type: 'set-workspace-divergence'; divergence: Record<string, BranchDivergence> }

export type AutoCommitAction =
  | {
      type: 'auto-commit-generation-started'
      projectId: string
      tabId: string
      workingTreeHash: string
      abortController: AbortController
      startedAt: number
    }
  | {
      type: 'auto-commit-generation-ready'
      projectId: string
      workingTreeHash: string
      title: string
      body: string
      generatedAt: number
    }
  | { type: 'auto-commit-clear'; projectId: string }

export type GitModeAction =
  | { type: 'enter-git-mode' }
  | { type: 'exit-git-mode' }
  | { type: 'git-mode-move-selection'; delta: -1 | 1 }
  | { type: 'git-mode-move-file-selection'; delta: -1 | 1 }
  | { type: 'git-mode-select-entry-by-key'; key: string }
  | { type: 'git-mode-toggle-folder'; key: string }
  | { type: 'git-mode-toggle-selected-folder' }
  | { type: 'git-mode-collapse-selection' }
  | { type: 'git-mode-expand-selection' }
  | { type: 'git-mode-toggle-file-list-mode' }
  | { type: 'git-mode-toggle-tree-compaction' }
  | { type: 'git-mode-set-diff'; key: string; diff: DiffData; hash: string }
  | {
      type: 'git-mode-set-parsed'
      key: string
      hash: string
      file: unknown
    }
  | {
      type: 'git-mode-set-highlights'
      key: string
      hash: string
      themeId: string
      add: unknown
      del: unknown
    }
  | {
      type: 'git-mode-merge-highlights'
      key: string
      hash: string
      themeId: string
      add: { start: number; tokens: unknown }[]
      del: { start: number; tokens: unknown }[]
    }
  | { type: 'git-mode-invalidate-diffs'; paths: string[] }
  | { type: 'git-mode-set-loading'; key: string; loading: boolean }
  | { type: 'git-mode-set-pending-delete'; path: string | null }
  | { type: 'git-mode-clear-diff-cache'; path: string }
  | { type: 'git-mode-set-message'; message: string | null }
  | { type: 'snippet-picker-set-message'; message: string | null }
  | { type: 'git-mode-toggle-diff-view' }
  | { type: 'git-mode-toggle-review-base' }
  | { type: 'git-mode-shift-head-offset'; delta: number }
  | { type: 'git-mode-set-head-offset'; offset: number }
  | {
      type: 'git-mode-fold-adjust'
      key: string
      foldId: string
      side: 'top' | 'bottom'
      delta: number
    }
  | { type: 'git-mode-fold-set'; key: string; foldId: string; top: number; bottom: number }
  | { type: 'git-mode-fold-toggle-all'; key: string }
  | {
      type: 'git-mode-optimistic-move'
      path: string
      fromSection: GitFileSection
      toSection: GitFileSection | null
    }
  | { type: 'open-git-commit-modal'; projectId?: string }
  | { type: 'git-commit-enter-confirm' }
  | { type: 'git-commit-leave-confirm' }
  | { type: 'git-commit-enter-generating'; projectId: string }
  | { type: 'git-commit-leave-generating' }
  | { type: 'git-commit-use-background-suggestion'; projectId: string }

export type DataAction =
  | { type: 'set-snippets'; snippets: SnippetRecord[] }
  | { type: 'delete-snippet'; snippetId: string }
  | { type: 'set-custom-commands'; customCommands: Record<AssistantId, string> }

export type MultiRepoAction =
  | { type: 'multi-repo-set-repos'; repos: DiscoveredRepo[] }
  | { type: 'multi-repo-clear' }

export type AppAction =
  | ModalAction
  | ProjectAction
  | TabAction
  | LayoutAction
  | UIAction
  | DataAction
  | GitPanelAction
  | GitModeAction
  | AutoCommitAction
  | MultiRepoAction

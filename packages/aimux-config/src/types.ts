// -----------------------------------------------------------------------------
// Self-contained types for the aimux keymap/config surface.
// These are duplicated from the aimux CLI's internal types to keep this
// package dependency-free. They must stay structurally identical with the
// CLI types in `aimux`'s `src/state/types.ts`, `src/input/modes/types.ts`,
// `src/ui/themes.ts`, and `src/state/layout-tree.ts`.
// -----------------------------------------------------------------------------

// ─── Mode identifiers ─────────────────────────────────────────────────────────

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

// ─── Primitive app types ──────────────────────────────────────────────────────

export type BuiltinAssistantId =
  | 'claude'
  | 'codex'
  | 'opencode'
  | 'grok'
  | 'kimi'
  | 'terminal'
  | 'antigravity'
export type AssistantId = BuiltinAssistantId | (string & {})
export type TabStatus = 'starting' | 'running' | 'disconnected' | 'error'

/**
 * Status values that may appear in legacy on-disk project snapshots but are
 * not produced by the running app anymore.
 */
export type LegacyPersistedTabStatus = TabStatus | 'exited'
export type TabActivity = 'working' | 'waiting-input' | 'idle'
export interface ProjectStatus {
  working: boolean
  waiting: boolean
}
export interface WorkspaceActivity {
  working: boolean
  waiting: boolean
  done: boolean
}
export type FocusMode =
  | 'navigation'
  | 'terminal-input'
  | 'modal'
  | 'command-edit'
  | 'git'
  | 'settings'
  | 'stats'
export type SplitDirection = 'horizontal' | 'vertical'

// ─── Terminal data shapes ─────────────────────────────────────────────────────

export interface TerminalSpan {
  text: string
  fg?: string
  bg?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  cursor?: boolean
}

export interface TerminalLine {
  spans: TerminalSpan[]
}

export interface TerminalSnapshot {
  lines: TerminalLine[]
  tailLines?: TerminalLine[]
  viewportY: number
  baseY: number
  cursorVisible: boolean
}

export interface TerminalModeState {
  mouseTrackingMode: 'none' | 'x10' | 'vt200' | 'drag' | 'any'
  sendFocusMode: boolean
  alternateScrollMode: boolean
  isAlternateBuffer: boolean
  bracketedPasteMode: boolean
}

// ─── Layout ───────────────────────────────────────────────────────────────────

export interface LayoutLeaf {
  type: 'leaf'
  tabId: string
}
export interface LayoutSplit {
  type: 'split'
  direction: SplitDirection
  ratio: number
  first: LayoutNode
  second: LayoutNode
}
export type LayoutNode = LayoutLeaf | LayoutSplit

// ─── Records ──────────────────────────────────────────────────────────────────

export interface PersistedTabSnapshot {
  id: string
  assistant: AssistantId
  title: string
  command: string
  status: Exclude<LegacyPersistedTabStatus, 'disconnected'>
  buffer: string
  viewport?: TerminalSnapshot
  terminalModes: TerminalModeState
  errorMessage?: string
  exitCode?: number
  workspaceId?: string
  autoRenameStatus?: 'eligible' | 'attempted'
}

export interface ProjectSnapshotV1 {
  version: 1
  savedAt: string
  activeTabId: string | null
  sidebar: {
    visible: boolean
    width: number
  }
  tabs: PersistedTabSnapshot[]
  layoutTree?: LayoutNode
  layoutTrees?: Record<string, LayoutNode>
  tabGroupMap?: Record<string, string>
  /**
   * Last viewed tab per workspace, keyed by workspace id. Optional and additive
   * (no version bump): older builds ignore it, newer builds tolerate its
   * absence. Written now so the data accrues, but restoring it at startup is
   * gated off until a future change flips RESTORE_LAST_ACTIVE_TAB_BY_WORKSPACE.
   */
  lastActiveTabByWorkspace?: Record<string, string>
}

export type WorkspaceSource = 'primary' | 'aimux-temp' | 'external'

export interface WorkspaceRecord {
  id: string
  name: string
  path: string
  repoRoot: string
  branch?: string
  baseRef?: string
  commitSha?: string
  source: WorkspaceSource
  createdByAimux: boolean
  color?: string
  createdAt: string
  updatedAt: string
  /** Last setup-script run for this workspace. Display only — the auto-run gate
   *  is "this session has not seen this workspace id before". */
  setupRanAt?: string
  setupExitCode?: number
}

export interface ProjectRecord {
  id: string
  name: string
  projectPath?: string
  createdAt: string
  updatedAt: string
  lastOpenedAt: string
  order?: number
  projectSnapshot?: ProjectSnapshotV1
  workspaces?: WorkspaceRecord[]
  activeWorkspaceId?: string
}

export interface TabSession {
  id: string
  assistant: AssistantId
  title: string
  status: TabStatus
  activity?: TabActivity
  buffer: string
  viewport?: TerminalSnapshot
  terminalModes: TerminalModeState
  command: string
  errorMessage?: string
  exitCode?: number
  workspaceId?: string
  /** This tab finished a turn while you were elsewhere. See `src/state/types.ts`. */
  unseen?: boolean
  autoRenameStatus?: 'eligible' | 'attempted'
  /** Real PTY tab that no chrome enumerates. See `src/state/types.ts`. */
  hidden?: boolean
  /** Who owns this tab, independent of visibility. See `src/state/types.ts`. */
  role?: 'setup'
}

export interface SnippetRecord {
  id: string
  name: string
  content: string
  trigger?: string
  vars?: Record<string, SnippetVar>
}

export type DirectoryResultType = 'git-repo' | 'workspace' | 'project'

export interface DirectoryResult {
  path: string
  type: DirectoryResultType
}

// ─── Bars / git panel / modal state (for ModeContext) ─────────────────────────

export type BarSide = 'left' | 'right'

export interface BarWidget {
  id: string
  grow: number
  visible: boolean
}

export interface BarState {
  visible: boolean
  width: number
  /** Ordered top → bottom. */
  widgets: BarWidget[]
}

export type BarsState = Record<BarSide, BarState>

export interface GitPaneState {
  diffModeRatio: number
  fileListMode: GitFileListMode
  treeCompaction: boolean
  path: GitPanePathConfig
  diffCount: GitPaneDiffCountConfig
  prefetchRadius: number
}

export type GitFileStatus = 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?'
export type GitFileSection = 'staged' | 'unstaged' | 'untracked' | 'historical'

export interface GitFileEntry {
  path: string
  renamedFrom?: string
  section: GitFileSection
  status: GitFileStatus
  added: number | null
  removed: number | null
  repoPath?: string
}

export type GitPanelError = 'not-a-repo' | 'unknown'

export interface GitPanelState {
  branch: string | null
  ahead: number
  behind: number
  files: GitFileEntry[]
  error: GitPanelError | null
}

export type DiffFileStatus =
  | 'modified'
  | 'new'
  | 'deleted'
  | 'binary'
  | 'renamed'
  | 'image'
  | 'too-large'

export interface DiffData {
  path: string
  status: DiffFileStatus
  oldPath?: string
  rawDiff: string
  binarySizeBefore?: number
  binarySizeAfter?: number
  errorMessage?: string
  imageBytesBefore?: Uint8Array
  imageBytesAfter?: Uint8Array
  imageMime?: string
  imageFormatLabel?: string
}

export type GitDiffView = 'split' | 'stacked'
export type GitFileListMode = 'tree' | 'flat'

export interface FoldState {
  top: number
  bottom: number
}

export interface GitModeState {
  selectedEntryKey: string | null
  collapsedFolders: Record<string, true>
  diffs: Record<string, DiffData>
  /** Parsed diff cache (internal); detailed shape lives in src/state/types. */
  parsedFiles: Record<string, { hash: string; file: unknown }>
  /** Syntax-highlight cache (internal). */
  highlights: Record<string, { hash: string; themeId: string; add: unknown; del: unknown }>
  loading: Record<string, boolean>
  pendingDeletePath: string | null
  actionMessage: string | null
  diffView: GitDiffView
  folds: Record<string, Record<string, FoldState>>
  headOffset: number
  reviewBase: boolean
}

interface ModalBase {
  selectedIndex: number
  editBuffer: string | null
  projectTargetId: string | null
  cursorPos?: number
  /**
   * Where the focus goes when this modal closes, when it is not back to the
   * panes. Set by whoever opened it, because that is who knows what is behind it
   * — the settings screen opens five different modals, and none of them should
   * have to grow a case in the reducer to find their way home.
   */
  returnTo?: FocusMode
}

export interface ModalClosed extends ModalBase {
  type: null
  editBuffer: null
  projectTargetId: null
}

export interface ModalNewTab extends ModalBase {
  type: 'new-tab'
  editingCommand: AssistantId | null
  /** Set when `create-workspace` chained into this picker. */
  pendingWorkspace?: PendingWorkspaceLaunch
  /** A prompt for the picked assistant, without the workspace pinning/rename. */
  pendingPrompt?: string
}
export interface PendingWorkspaceLaunch {
  projectId: string
  workspaceId: string
  prompt: string
}
export interface ModalProjectPicker extends ModalBase {
  type: 'project-picker'
}
export interface ModalProjectName extends ModalBase {
  type: 'project-name'
  returnToProjectPicker: boolean
}
export interface ModalRenameTab extends ModalBase {
  type: 'rename-tab'
}
/** Fuzzy-ish search across every setting, from inside the settings screen. */
export interface ModalSettingsSearch extends ModalBase {
  type: 'settings-search'
}
export interface ModalSettingText extends ModalBase {
  type: 'setting-text'
  settingId: string
  settingLabel: string
}
export interface ModalRenameWorkspace extends ModalBase {
  type: 'rename-workspace'
  workspaceProjectId: string
}
export interface ModalSnippetPicker extends ModalBase {
  type: 'snippet-picker'
  actionMessage?: string | null
}
export interface ModalThemePicker extends ModalBase {
  type: 'theme-picker'
  entryCount: number
}
export interface ModalHelp extends ModalBase {
  type: 'help'
  entryCount: number
  scope: ModeId | null
}
export interface ModalSplitPicker extends ModalBase {
  type: 'split-picker'
  splitDirection: SplitDirection
}
export interface ModalCreateProject extends ModalBase {
  type: 'create-project'
  directoryResults: DirectoryResult[]
  pendingProjectPath: string | null
  activeField: 'directory' | 'name'
  nameBuffer: string
  returnToProjectPicker: boolean
}
export interface ModalCreateWorkspace extends ModalBase {
  type: 'create-workspace'
  activeField: 'prompt' | 'base'
  /** "What do you want to work on?" — names the workspace and its branch. */
  prompt: string
  branchError: string | null
  baseQuery: string
  baseRef: string
  baseBranches: string[]
}
export interface ModalGitCommit extends ModalBase {
  type: 'git-commit'
  activeField: 'title' | 'body'
  contentBuffer: string
  stage: 'edit' | 'generating' | 'confirm'
}
export interface ModalSnippetEditor extends ModalBase {
  type: 'snippet-editor'
  activeField: 'name' | 'trigger' | 'content'
  nameBuffer: string
  triggerBuffer: string
  contentBuffer: string
}

export interface ModalUpdateAvailable extends ModalBase {
  type: 'update-available'
  currentVersion: string
  latestVersion: string
}

/** The status bar's usage indicator, expanded. Carries nothing: it is a readout. */
export interface ModalQuotas extends ModalBase {
  type: 'quotas'
}

export interface ModalWorkspaceMove extends ModalBase {
  type: 'workspace-move'
  /** The workspace being moved (may differ from the active one, e.g. a tab menu). */
  sourceWorkspaceId: string
  deleteSource: boolean
  /** Per-workspace dirty file counts, loaded async when the modal opens. */
  stats: { kind: 'loading' } | { kind: 'ready'; dirtyFiles: Record<string, number> }
}

/**
 * Confirmation for a recoverable move failure: the target's dirty files
 * overlap the incoming changes (stash-target) or the squash conflicts
 * (keep-conflicts). Both workspaces are already restored; confirming re-runs
 * move-workspace with the matching flag.
 */
export interface ModalWorkspaceMoveConfirm extends ModalBase {
  type: 'workspace-move-confirm'
  variant: 'stash-target' | 'keep-conflicts'
  files: string[]
  projectId: string
  sourceWorkspaceId: string
  targetWorkspaceId: string
  deleteSource: boolean
  sourceLabel: string
  targetLabel: string
}

/**
 * Standalone confirmation for a recoverable workspace delete failure triggered
 * outside the new-tab picker (e.g. the sidebar's "Remove workspace"). Carries the
 * params needed to re-run the delete with force once confirmed.
 */
export interface ModalWorkspaceDeleteConfirm extends ModalBase {
  type: 'workspace-delete-confirm'
  projectId: string
  workspaceId: string
  workspaceLabel: string
  reason: string
  closeTabs: boolean
  /** Whether confirming force-deletes — true only after a recoverable failure. */
  force: boolean
}

export type FlashJumpTargetKind = 'project' | 'workspace' | 'tab'

export interface FlashJumpTarget {
  kind: FlashJumpTargetKind
  projectIndex: number
  projectId: string
  workspaceId?: string
  tabId?: string
}

export interface FlashLabel {
  key: string
  label: string
  target: FlashJumpTarget
}

export interface ModalFlashJump extends ModalBase {
  type: 'flash-jump'
  labels: FlashLabel[]
  buffer: string
  pendingJump: FlashJumpTarget | null
}

export type ModalState =
  | ModalClosed
  | ModalNewTab
  | ModalProjectPicker
  | ModalProjectName
  | ModalRenameTab
  | ModalRenameWorkspace
  | ModalSnippetPicker
  | ModalThemePicker
  | ModalHelp
  | ModalSplitPicker
  | ModalCreateProject
  | ModalCreateWorkspace
  | ModalSnippetEditor
  | ModalGitCommit
  | ModalUpdateAvailable
  | ModalQuotas
  | ModalWorkspaceMove
  | ModalWorkspaceMoveConfirm
  | ModalWorkspaceDeleteConfirm
  | ModalFlashJump
  | ModalSettingText
  | ModalSettingsSearch

export interface LayoutState {
  terminalCols: number
  terminalRows: number
}

export interface ProjectBarState {
  visible: boolean
}

export type AutoCommitSuggestion =
  | { kind: 'idle' }
  | {
      kind: 'generating'
      tabId: string
      workingTreeHash: string
      abortController: AbortController
      startedAt: number
    }
  | {
      kind: 'ready'
      tabId: string
      workingTreeHash: string
      title: string
      body: string
      generatedAt: number
    }

export interface AutoCommitState {
  byProject: Record<string, AutoCommitSuggestion>
}

export interface DiscoveredRepo {
  path: string
  name: string
  isRoot: boolean
}

export interface MultiRepoState {
  repos: DiscoveredRepo[]
  prefixes: Record<string, string>
}

/** Where the cursor is in the settings screen — the cursor only, not the values. */
export interface SettingsUIState {
  sectionId: string
  pane: 'nav' | 'rows'
  rowIndex: number
}

/** Mirror of the CLI's `StatsUIState`. */
export interface StatsUIState {
  pageIndex: number
  scrollTop: number
}

export interface AppState {
  tabs: TabSession[]
  activeTabId: string | null
  layoutTrees: Record<string, LayoutNode>
  tabGroupMap: Record<string, string>
  projects: ProjectRecord[]
  currentProjectId: string | null
  projectStatuses: Record<string, ProjectStatus>
  projectBar: ProjectBarState
  snippets: SnippetRecord[]
  focusMode: FocusMode
  bars: BarsState
  gitPane: GitPaneState
  modal: ModalState
  layout: LayoutState
  customCommands: Record<AssistantId, string>
  gitPanel: GitPanelState
  gitMode: GitModeState
  autoCommit: AutoCommitState
  multiRepo: MultiRepoState
  settings: SettingsUIState
  stats: StatsUIState
  workspaceDivergence: Record<string, BranchDivergence>
  workspaceActivity: Record<string, WorkspaceActivity>
  lastActiveTabByWorkspace: Record<string, string>
  pendingChords: string[] | null
}

// ─── AppAction union ──────────────────────────────────────────────────────────

export type ModalAction =
  | {
      type: 'open-new-tab-modal'
      pendingWorkspace?: PendingWorkspaceLaunch
      pendingPrompt?: string
    }
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
  | { type: 'open-snippet-picker'; returnTo?: FocusMode }
  | { type: 'open-snippet-editor'; snippetId?: string }
  | { type: 'set-help-entry-count'; count: number }
  | { type: 'set-theme-entry-count'; count: number }
  | { type: 'open-theme-picker'; returnTo?: FocusMode }
  | { type: 'open-update-available-modal'; currentVersion: string; latestVersion: string }
  | { type: 'open-quotas-modal' }
  | { type: 'set-modal-selection-index'; index: number }
  | { type: 'open-edit-custom-command'; assistantId: AssistantId }
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
  | { type: 'load-project'; projectId: string; projectSnapshot?: ProjectSnapshotV1 }
  | { type: 'set-projects'; projects: ProjectRecord[] }
  | { type: 'create-project-record'; project: ProjectRecord }
  | { type: 'rename-project-record'; projectId: string; name: string }
  | { type: 'delete-project-record'; projectId: string; openProjectPicker?: boolean }
  | { type: 'reorder-projects'; orderedIds: string[] }
  | { type: 'reorder-active-project'; delta: number }
  | { type: 'set-project-status'; projectId: string; status: ProjectStatus }
  | { type: 'set-workspace-activity'; workspaceId: string; working: boolean; waiting: boolean }
  | { type: 'mark-workspace-done'; workspaceId: string }
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
  | { type: 'reset-tab-project'; tabId: string }
  | { type: 'rename-tab'; tabId: string; title: string }
  | { type: 'append-tab-buffer'; tabId: string; chunk: string }
  | {
      type: 'replace-tab-viewport'
      tabId: string
      viewport: TerminalSnapshot
      terminalModes: TerminalModeState
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

export type SettingsAction =
  | { type: 'enter-settings' }
  | { type: 'exit-settings' }
  | { type: 'settings-focus-pane'; pane: 'nav' | 'rows' }
  | { type: 'settings-move-selection'; delta: -1 | 1 }
  | { type: 'settings-select-section'; sectionId: string }
  | { type: 'settings-select-row'; rowIndex: number }
  | { type: 'open-settings-search' }
  | { type: 'open-setting-text-modal'; settingId: string; label: string; value: string }

export type StatsAction =
  | { type: 'enter-stats' }
  | { type: 'exit-stats' }
  | { type: 'stats-move-page'; delta: -1 | 1 }
  | { type: 'stats-select-page'; pageIndex: number }
  /** Rows, not pixels: the view holds a scroll offset the page applies to its box. */
  | { type: 'stats-scroll'; delta: number }
  /** The offset the scrollbox actually accepted, sent back so the state cannot run past the page. */
  | { type: 'stats-scroll-settled'; scrollTop: number }

export interface GitRefreshPayload {
  branch: string | null
  ahead: number
  behind: number
  files: GitFileEntry[]
}

/** Commits a workspace branch is ahead/behind the ref it forked from. */
export interface BranchDivergence {
  ahead: number
  behind: number
  /** Lines changed since the fork point, working tree included. */
  added?: number
  removed?: number
}

export type GitPanelAction =
  | { type: 'git-refresh-success'; payload: GitRefreshPayload }
  | { type: 'git-refresh-error'; kind: GitPanelError }
  | { type: 'git-panel-reset' }
  | { type: 'set-workspace-divergence'; divergence: Record<string, BranchDivergence> }
  | { type: 'set-git-pane'; patch: Partial<GitPaneState> }

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

export type DataAction =
  | { type: 'set-snippets'; snippets: SnippetRecord[] }
  | { type: 'delete-snippet'; snippetId: string }

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

export type AppAction =
  | ModalAction
  | ProjectAction
  | TabAction
  | LayoutAction
  | UIAction
  | SettingsAction
  | StatsAction
  | DataAction
  | GitPanelAction
  | GitModeAction
  | AutoCommitAction

// ─── Side effects ─────────────────────────────────────────────────────────────

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
  | { type: 'apply-theme'; action: 'preview'; delta: 1 | -1 }
  | { type: 'rename-project'; projectId: string; name: string }
  | { type: 'rename-tab'; tabId: string; title: string }
  | { type: 'split-pane'; direction: SplitDirection; sourceTabId?: string }
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
  | { type: 'switch-project-by-index'; index: number }
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
  | { type: 'toggle-transparent' }
  | { type: 'toggle-mode' }
  | { type: 'open-file-in-editor'; path: string }
  | { type: 'open-selected-snippet-source-in-editor' }
  | { type: 'run-setup' }
  | { type: 'stop-setup' }
  | { type: 'configure-setup-script'; projectId?: string }
  | { type: 'ask-agent-for-setup-script' }
  | { type: 'promote-setup-tab' }
  | { type: 'activate-settings-row' }
  | { type: 'adjust-settings-row'; delta: 1 | -1 }
  | { type: 'reset-settings-row' }
  | { type: 'confirm-settings-search' }
  | { type: 'commit-setting-text'; settingId: string; value: string }

// ─── Key input / KeyResult / ModeContext ──────────────────────────────────────

/** Structural shape for a parsed key event. Matches @opentui/core's KeyEvent. */
export interface KeyInput {
  name: string
  ctrl: boolean
  meta: boolean
  shift: boolean
  sequence: string
}

export interface KeyResult {
  actions: AppAction[]
  effects: SideEffect[]
  transition?: ModeId
}

export interface ModeContext {
  readonly state: AppState
}

// ─── Themes ───────────────────────────────────────────────────────────────────

// Theme types now live in `./tui` (1:1 port of opencode TUI). The aliases
// below preserve internal type wiring for the user-facing config API.

export type ThemeMode = 'light' | 'dark'

// ─── Backend config (stub) ────────────────────────────────────────────────────

export interface BackendConfig {
  command: string
  args?: string[]
}

// ─── Sidebar config (stub) ────────────────────────────────────────────────────

export interface SidebarConfig {
  widgets?: string[]
  width?: number
}

// ─── Hooks config (stub) ──────────────────────────────────────────────────────

export interface HooksConfig {
  onProjectCreate?: (project: { name: string; projectPath?: string }) => void | Promise<void>
}

// ─── Snippet config (stub) ────────────────────────────────────────────────────

/**
 * A snippet variable resolved at expansion time. The shape is a tagged union
 * discriminated by which key is present (`sh` for now; future: `env`, `date`, …).
 */
export interface SnippetShellVar {
  /** Shell command run via `sh -c`. The trimmed stdout is interpolated. */
  sh: string
  /** Kill the process after this many ms. Default 5000. */
  timeout?: number
  /** Trim trailing whitespace from stdout. Default true. */
  trim?: boolean
}

export type SnippetVar = SnippetShellVar

export interface SnippetDef {
  name: string
  trigger?: string
  text: string
  /**
   * Optional named variables. Reference them in `text` as `{{name}}`.
   * The key is the variable name; the value declares how to resolve it.
   */
  vars?: Record<string, SnippetVar>
}

// ─── Action value types ───────────────────────────────────────────────────────

export type ActionFn = (ctx: ModeContext) => KeyResult | null
export type Action = KeyResult | ActionFn

// ─── Keymap builder API types ─────────────────────────────────────────────────

export interface BindingOptions {
  repeatable?: boolean
}

export interface GroupBuilderApi {
  map(keys: string, action: Action, description?: string, opts?: BindingOptions): GroupBuilderApi
  group(
    prefix: string,
    name: string,
    configure: (g: GroupBuilderApi) => GroupBuilderApi
  ): GroupBuilderApi
}

export interface ModeBindingBuilderApi {
  map(
    keys: string,
    action: Action,
    description?: string,
    opts?: BindingOptions
  ): ModeBindingBuilderApi
  unmap(keys: string): ModeBindingBuilderApi
  group(
    prefix: string,
    name: string,
    configure: (g: GroupBuilderApi) => GroupBuilderApi
  ): ModeBindingBuilderApi
  passthrough(): ModeBindingBuilderApi
}

export interface KeymapBuilderApi {
  leader(key: string): KeymapBuilderApi
  timeout(ms: number): KeymapBuilderApi
  mode(
    id: ModeId | readonly ModeId[],
    configure: (m: ModeBindingBuilderApi) => ModeBindingBuilderApi
  ): KeymapBuilderApi
}

// ─── Top-level user config ────────────────────────────────────────────────────

export interface ProjectBarConfig {
  /** Startup override for the project bar visibility. Reapplied on each launch. */
  initialVisible?: boolean
  /** @deprecated Use `initialVisible` instead. */
  visible?: boolean
}

// ─── Git pane config (discriminated union) ────────────────────────────────────

export type GitPanePathConfig =
  | { enabled: false }
  | { enabled: true; pathFn?: (path: string) => string }

export interface GitPaneDiffCountConfig {
  enabled: boolean
}

interface GitPaneBaseConfig {
  /** Startup override for git pane visibility. Reapplied on each launch. */
  initialVisible?: boolean
  /** Startup override for the pane split ratio. Reapplied on each launch. */
  initialRatio?: number
  /** Startup override for fullscreen diff ratio. Reapplied on each launch. */
  initialDiffModeRatio?: number
  /** Startup override for tree/flat file list mode. Reapplied on each launch. */
  initialFileListMode?: GitFileListMode
  /** Startup override for tree compaction. Reapplied on each launch. */
  initialTreeCompaction?: boolean
  path?: GitPanePathConfig
  diffCount?: GitPaneDiffCountConfig
  /** Prefetch N neighbouring diffs around the cursor; 0 disables. */
  prefetchRadius?: number
  /** @deprecated Use `initialVisible` instead. */
  visible?: boolean
  /** @deprecated Use `initialRatio` instead. */
  ratio?: number
  /** @deprecated Use `initialDiffModeRatio` instead. */
  diffModeRatio?: number
  /** @deprecated Use `initialFileListMode` instead. */
  fileListMode?: GitFileListMode
  /** @deprecated Use `initialTreeCompaction` instead. */
  treeCompaction?: boolean
}

export interface GitPaneEmbeddedConfig extends GitPaneBaseConfig {
  initialMode?: 'embedded'
  initialPosition?: 'top' | 'bottom'
  /** @deprecated Use `initialMode` instead. */
  mode?: 'embedded'
  /** @deprecated Use `initialPosition` instead. */
  position?: 'top' | 'bottom'
}

export interface GitPanePaneConfig extends GitPaneBaseConfig {
  initialMode: 'pane'
  initialPosition?: 'left' | 'right'
  /** @deprecated Use `initialMode` instead. */
  mode: 'pane'
  /** @deprecated Use `initialPosition` instead. */
  position?: 'left' | 'right'
}

export type GitPaneConfig = GitPaneEmbeddedConfig | GitPanePaneConfig

export interface AutoCommitConfig {
  enabled: boolean
  timeoutMs: number
  models: Partial<Record<string, string>>
}

export interface AutoRenameConfig {
  enabled: boolean
  timeoutMs: number
  models: Partial<Record<string, string>>
  /**
   * Quiet period after a title-worthy prompt before a title is generated.
   * Prompts submitted inside the window are appended to the same request, so a
   * "read X" / "now do Y" opening yields one title instead of two.
   */
  settleMs: number
  /** Generation attempts before falling back to a title derived locally from the prompt. */
  maxAttempts: number
  /**
   * Prompts with fewer words than this are treated as menu answers or
   * confirmations and ignored (they do not consume an attempt).
   */
  minPromptWords: number
}

export interface MultiRepoConfig {
  /** When true, scan projectPath for nested git repos and aggregate their status into the git panel. */
  enabled: boolean
  /** How deep to scan below projectPath when discovering sub-repos. 1 = immediate children only. */
  maxDepth: number
}

export interface AimuxThemeConfig {
  /** Startup theme id (one of `THEME_IDS` from `@brimveyn/aimux-config`). */
  initialId?: string
  /** Startup override for light/dark mode. Reapplied on each launch. */
  initialMode?: ThemeMode
  /** @deprecated Use `initialMode` instead. */
  mode?: ThemeMode
  /**
   * Beta — bridge the active aimux theme into Claude Code by writing
   * `~/.claude/themes/aimux.json` and selecting it in `~/.claude/settings.json`.
   * Off by default. Requires Claude Code v2.1.118 or later.
   */
  beta?: {
    harmonizeClaudeTheme?: boolean
    /**
     * Draw each agent state (idle, working, waiting, done) as a small animated
     * sprite rather than a spinner and a set of dots. Needs a terminal that
     * speaks the Kitty graphics protocol (Kitty, Ghostty, WezTerm) and does not
     * work under tmux. Sprites are read from `<config dir>/sprites`, falling
     * back to the ones aimux ships.
     */
    experimentalActivitySprites?: boolean
    /**
     * Disable Claude Code's built-in syntax highlighting and re-color diff
     * lines from the aimux theme via shiki. Sets
     * `CLAUDE_CODE_SYNTAX_HIGHLIGHT=false` for child PTYs and post-processes
     * the terminal snapshot in the app.
     */
    experimentalSyntaxHighlight?: boolean
  }
}

export type AIUsageTool = 'claude' | 'codex'

export interface AIUsageToolConfig {
  enabled?: boolean
  pollSeconds?: number
  claudePlan?: 'auto' | 'pro' | 'max5' | 'max20'
  codexWeeklyLimit?: number
  tools?: AIUsageTool[]
}

export type StatusBarSeparator = 'arrow' | 'round' | 'slant' | 'flame' | 'none'

export interface StatusBarConfig {
  aiUsage?: AIUsageToolConfig
  /**
   * Powerline-style glyph used between status bar sections.
   * - `arrow` (default): solid triangles (    / )
   * - `round`: solid semicircles (    / )
   * - `slant`: solid slopes (    / )
   * - `flame`: solid flame ribbons (    / )
   * - `none`: no glyph, sections snap via background colour only
   *
   * All non-`none` options require a nerd-font / powerline-capable font.
   */
  separator?: StatusBarSeparator
}

export interface ExternalEditorConfig {
  /** Override `$VISUAL` / `$EDITOR`. */
  command?: string
  /**
   * Force GUI (detached spawn — for vscode/cursor/etc.) or TUI (inline shellout
   * that hands the TTY to the editor). Defaults: GUI for editors in a built-in
   * allowlist (`code`, `cursor`, `subl`, JetBrains, …), TUI otherwise.
   */
  kind?: 'gui' | 'tui'
  /** Argv passed to the editor. Placeholders: `{file}`, `{line}`. Sensible defaults per known editor. */
  args?: string[]
  /**
   * Opt-in escape hatch for TUI editors only: when set, the TUI editor is
   * launched in a new terminal window using this argv template instead of the
   * default inline shellout. Ignored when `kind` resolves to `'gui'` — GUI
   * editors always spawn detached into their own app window.
   *
   * Placeholders: `{cmd}` (shell-quoted `cd <cwd> && <editor> <args>`), `{cwd}`.
   * Example: `['wezterm', 'start', '--cwd', '{cwd}', '--', 'sh', '-c', '{cmd}']`.
   */
  terminal?: string[]
}

export interface AimuxIntegrationsConfig {
  /**
   * Opt-in: install Claude Code lifecycle hooks into `~/.claude/settings.json`
   * so per-tab activity (working / waiting-input / idle) is driven by Claude's
   * own events rather than visual scraping of the terminal. Off by default.
   *
   * When enabled, aimux writes six entries marked `__aimux: true` into the
   * user's settings file at startup, and the daemon publishes a hook URL on
   * `127.0.0.1` for Claude to call back into. Unrelated hooks the user has
   * configured are preserved. See `docs/guide/claude-integration.md`.
   */
  claudeHooks?: boolean
}

export interface AimuxUserConfig {
  theme?: AimuxThemeConfig
  keymaps?: (k: KeymapBuilderApi) => KeymapBuilderApi
  backends?: Record<string, BackendConfig>
  sidebar?: SidebarConfig
  projectBar?: ProjectBarConfig
  /** @deprecated renamed to `projectBar`. Still read in 0.9.0. */
  sessionBar?: ProjectBarConfig
  gitPane?: GitPaneConfig
  hooks?: HooksConfig
  snippets?: SnippetDef[]
  /**
   * Single-character prefix that opens an inline snippet trigger.
   * Defaults to `:` (Espanso-style). Typing `<char><trigger><separator>` in
   * any non-alternate-screen terminal expands the matching snippet.
   */
  snippetTriggerChar?: string
  autoCommit?: Partial<AutoCommitConfig>
  autoRename?: Partial<AutoRenameConfig>
  multiRepo?: Partial<MultiRepoConfig>
  statusBar?: StatusBarConfig
  externalEditor?: ExternalEditorConfig
  integrations?: AimuxIntegrationsConfig
  /**
   * @deprecated Removed. Workspace provisioning is a per-project setup script
   * now — see `docs/guide/workspaces.md#setup`. Declared here only so the strike
   * -through shows up in your editor: an unknown key parses silently, so without
   * it the setting would just vanish with no signal at all.
   */
  workspaceTemplates?: never
  /** @deprecated Removed. See `workspaceTemplates`. */
  worktreeTemplates?: never
}

// ─── Resolved config (internal) ───────────────────────────────────────────────

export interface BindingDef {
  keys: string
  result: Action
  group?: string
  description?: string
  repeatable?: boolean
}

export interface ModeKeymapDef {
  bindings: BindingDef[]
  removals: string[]
  isPassthrough: boolean
}

export interface ResolvedKeymapConfig {
  leader: string
  timeout: number
  modes: Map<ModeId, ModeKeymapDef>
}

export interface ResolvedConfig {
  theme:
    | {
        initialId?: string
        initialMode?: ThemeMode
        beta?: {
          harmonizeClaudeTheme?: boolean
          experimentalSyntaxHighlight?: boolean
        }
      }
    | undefined
  keymaps: ResolvedKeymapConfig
  backends: Record<string, BackendConfig>
  sidebar: SidebarConfig
  projectBar: {
    initialVisible?: boolean
  }
  /**
   * Placement (`initialMode`/`initialPosition`/`initialRatio`/`initialVisible`)
   * moved to the bars layout in `aimux.json`; those fields are still accepted
   * in user config but ignored.
   */
  gitPane: {
    initialDiffModeRatio?: number
    initialFileListMode?: GitFileListMode
    initialTreeCompaction?: boolean
    path?: GitPanePathConfig
    diffCount?: GitPaneDiffCountConfig
    prefetchRadius?: number
  }
  hooks: HooksConfig
  snippets: SnippetDef[]
  snippetTriggerChar: string
  autoCommit: AutoCommitConfig
  autoRename: AutoRenameConfig
  multiRepo: MultiRepoConfig
  statusBar: StatusBarConfig
  externalEditor: ExternalEditorConfig
  integrations: {
    claudeHooks: boolean
  }
}

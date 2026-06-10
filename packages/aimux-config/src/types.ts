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
  | 'modal.git-commit.confirm'
  | 'modal.git-commit.generating'
  | 'modal.update-available'
  | 'modal.worktree-move'
  | 'modal.ai-usage'

// ─── Primitive app types ──────────────────────────────────────────────────────

export type BuiltinAssistantId = 'claude' | 'codex' | 'opencode' | 'terminal' | 'antigravity'
export type AssistantId = BuiltinAssistantId | (string & {})
export type TabStatus = 'starting' | 'running' | 'disconnected' | 'error'

/**
 * Status values that may appear in legacy on-disk workspace snapshots but are
 * not produced by the running app anymore.
 */
export type LegacyPersistedTabStatus = TabStatus | 'exited'
export type TabActivity = 'working' | 'waiting-input' | 'idle'
export interface SessionStatus {
  working: boolean
  waiting: boolean
}
export type FocusMode = 'navigation' | 'terminal-input' | 'modal' | 'command-edit' | 'git'
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
  worktreeId?: string
}

export interface WorkspaceSnapshotV1 {
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
}

export type WorktreeSource = 'primary' | 'aimux-temp' | 'external'

export interface WorktreeRecord {
  id: string
  name: string
  path: string
  repoRoot: string
  branch?: string
  baseRef?: string
  commitSha?: string
  source: WorktreeSource
  createdByAimux: boolean
  color?: string
  createdAt: string
  updatedAt: string
}

export interface SessionRecord {
  id: string
  name: string
  projectPath?: string
  createdAt: string
  updatedAt: string
  lastOpenedAt: string
  order?: number
  workspaceSnapshot?: WorkspaceSnapshotV1
  worktrees?: WorktreeRecord[]
  activeWorktreeId?: string
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
  worktreeId?: string
}

export interface SnippetRecord {
  id: string
  name: string
  content: string
  trigger?: string
  vars?: Record<string, SnippetVar>
}

export type DirectoryResultType = 'git-repo' | 'worktree' | 'workspace'

export interface DirectoryResult {
  path: string
  type: DirectoryResultType
}

// ─── Sidebar / git panel / modal state (for ModeContext) ──────────────────────

export interface SidebarState {
  visible: boolean
  width: number
  minWidth: number
  maxWidth: number
}

export interface GitPaneState {
  visible: boolean
  mode: 'embedded' | 'pane'
  position: 'top' | 'bottom' | 'left' | 'right'
  paneRatio: number
  embeddedRatio: number
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

export type DiffFileStatus = 'modified' | 'new' | 'deleted' | 'binary' | 'renamed' | 'image'

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
  sessionTargetId: string | null
  cursorPos?: number
}

export interface ModalClosed extends ModalBase {
  type: null
  editBuffer: null
  sessionTargetId: null
}

export interface ModalNewTab extends ModalBase {
  type: 'new-tab'
  editingCommand: AssistantId | null
  activeField: 'assistant' | 'branch-name' | 'target-worktree' | 'worktree-name'
  branchError: string | null
  branchName: string
  createWorktree: boolean
  selectedAssistantId: AssistantId | null
  step: 'assistant' | 'worktree' | 'worktree-create' | 'template'
  targetWorktreeIndex: number
  worktreeDeleteConfirmId: string | null
  worktreeDeleteMessage: string | null
  worktreeName: string
}
export interface ModalSessionPicker extends ModalBase {
  type: 'session-picker'
}
export interface ModalSessionName extends ModalBase {
  type: 'session-name'
  returnToSessionPicker: boolean
}
export interface ModalRenameTab extends ModalBase {
  type: 'rename-tab'
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
export interface ModalCreateSession extends ModalBase {
  type: 'create-session'
  directoryResults: DirectoryResult[]
  pendingProjectPath: string | null
  activeField: 'directory' | 'name'
  nameBuffer: string
  returnToSessionPicker: boolean
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

export interface ModalAIUsage extends ModalBase {
  type: 'ai-usage'
}

export interface ModalWorktreeMove extends ModalBase {
  type: 'worktree-move'
  /** The worktree being moved (may differ from the active one, e.g. a tab menu). */
  sourceWorktreeId: string
  deleteSource: boolean
}

export type ModalState =
  | ModalClosed
  | ModalNewTab
  | ModalSessionPicker
  | ModalSessionName
  | ModalRenameTab
  | ModalSnippetPicker
  | ModalThemePicker
  | ModalHelp
  | ModalSplitPicker
  | ModalCreateSession
  | ModalSnippetEditor
  | ModalGitCommit
  | ModalUpdateAvailable
  | ModalAIUsage
  | ModalWorktreeMove

export interface LayoutState {
  terminalCols: number
  terminalRows: number
}

export interface SessionBarState {
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
  bySession: Record<string, AutoCommitSuggestion>
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

export interface AppState {
  tabs: TabSession[]
  activeTabId: string | null
  layoutTrees: Record<string, LayoutNode>
  tabGroupMap: Record<string, string>
  sessions: SessionRecord[]
  currentSessionId: string | null
  sessionStatuses: Record<string, SessionStatus>
  sessionBar: SessionBarState
  snippets: SnippetRecord[]
  focusMode: FocusMode
  sidebar: SidebarState
  gitPane: GitPaneState
  modal: ModalState
  layout: LayoutState
  customCommands: Record<AssistantId, string>
  gitPanel: GitPanelState
  gitMode: GitModeState
  autoCommit: AutoCommitState
  multiRepo: MultiRepoState
  worktreeDivergence: Record<string, BranchDivergence>
  pendingChords: string[] | null
  worktreeTemplates: WorktreeTemplate[]
}

// ─── AppAction union ──────────────────────────────────────────────────────────

export type ModalAction =
  | { type: 'open-new-tab-modal' }
  | { type: 'set-new-tab-branch-error'; message: string | null }
  | {
      type: 'set-new-tab-worktree-delete-state'
      confirmWorktreeId?: string | null
      message: string | null
    }
  | { type: 'enter-new-tab-worktree-create' }
  | { type: 'enter-new-tab-template-shortcut' }
  | { type: 'select-new-tab-assistant'; assistantId?: AssistantId }
  | { type: 'toggle-new-tab-worktree'; assistantId?: AssistantId }
  | { type: 'open-help-modal'; scope?: ModeId }
  | { type: 'open-split-picker'; direction: SplitDirection }
  | { type: 'open-session-picker' }
  | {
      type: 'open-session-name-modal'
      sessionTargetId?: string
      initialName?: string
      returnToSessionPicker?: boolean
    }
  | { type: 'close-modal' }
  | { type: 'move-modal-selection'; delta: number }
  | { type: 'update-command-edit'; char: string }
  | { type: 'cancel-command-edit' }
  | { type: 'open-create-session-modal'; returnToSessionPicker: boolean }
  | { type: 'set-directory-results'; results: DirectoryResult[] }
  | { type: 'switch-create-session-field' }
  | { type: 'select-directory' }
  | { type: 'open-rename-tab-modal' }
  | { type: 'open-snippet-picker' }
  | { type: 'open-snippet-editor'; snippetId?: string }
  | { type: 'set-help-entry-count'; count: number }
  | { type: 'set-theme-entry-count'; count: number }
  | { type: 'open-theme-picker' }
  | { type: 'open-update-available-modal'; currentVersion: string; latestVersion: string }
  | { type: 'set-modal-selection-index'; index: number }
  | { type: 'open-ai-usage-modal' }
  | { type: 'open-edit-custom-command'; assistantId: AssistantId }
  | { type: 'open-worktree-move-modal'; sourceWorktreeId: string }
  | { type: 'toggle-worktree-move-delete' }

export type SessionAction =
  | { type: 'load-session'; sessionId: string; workspaceSnapshot?: WorkspaceSnapshotV1 }
  | { type: 'set-sessions'; sessions: SessionRecord[] }
  | { type: 'create-session-record'; session: SessionRecord }
  | { type: 'rename-session-record'; sessionId: string; name: string }
  | { type: 'delete-session-record'; sessionId: string; openSessionPicker?: boolean }
  | { type: 'reorder-sessions'; orderedIds: string[] }
  | { type: 'reorder-active-session'; delta: number }
  | { type: 'set-session-status'; sessionId: string; status: SessionStatus }
  | { type: 'add-worktree-record'; sessionId: string; worktree: WorktreeRecord; activate?: boolean }
  | { type: 'remove-worktree-record'; sessionId: string; worktreeId: string }
  | { type: 'set-active-worktree'; sessionId: string; worktreeId: string }
  | {
      type: 'update-worktree-record'
      sessionId: string
      worktreeId: string
      patch: Partial<WorktreeRecord>
    }

export type TabAction =
  | { type: 'add-tab'; tab: TabSession }
  | {
      type: 'hydrate-workspace'
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
  | { type: 'reset-tab-session'; tabId: string }
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
  | { type: 'toggle-sidebar' }
  | { type: 'resize-sidebar'; delta: number }
  | { type: 'set-sidebar-width'; width: number }
  | { type: 'set-focus-mode'; focusMode: FocusMode }
  | { type: 'set-terminal-size'; cols: number; rows: number }
  | { type: 'toggle-git-pane' }
  | { type: 'resize-git-pane'; delta: number }
  | { type: 'set-git-pane-ratio'; target: 'pane' | 'embedded'; ratio: number }
  | { type: 'resize-git-diff-pane'; delta: number }
  | { type: 'set-git-pane-mode'; mode: 'embedded' | 'pane' }
  | { type: 'set-git-pane-position'; position: 'top' | 'bottom' | 'left' | 'right' }
  | { type: 'set-pending-chords'; chords: string[] | null }
  | { type: 'toggle-session-bar' }

export interface GitRefreshPayload {
  branch: string | null
  ahead: number
  behind: number
  files: GitFileEntry[]
}

/** Commits a worktree branch is ahead/behind the ref it forked from. */
export interface BranchDivergence {
  ahead: number
  behind: number
}

export interface WorktreeTemplatePane {
  id: string
  assistant: string
  splitFrom?: string
  direction?: SplitDirection
  ratio?: number
  send?: string
}

export interface WorktreeTemplateTab {
  panes: WorktreeTemplatePane[]
}

export interface WorktreeTemplate {
  id: string
  name: string
  description?: string
  tabs: WorktreeTemplateTab[]
}

export type GitPanelAction =
  | { type: 'git-refresh-success'; payload: GitRefreshPayload }
  | { type: 'git-refresh-error'; kind: GitPanelError }
  | { type: 'git-panel-reset' }
  | { type: 'set-worktree-divergence'; divergence: Record<string, BranchDivergence> }

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
  | { type: 'open-git-commit-modal'; sessionId?: string }
  | { type: 'git-commit-enter-confirm' }
  | { type: 'git-commit-leave-confirm' }
  | { type: 'git-commit-enter-generating'; sessionId: string }
  | { type: 'git-commit-leave-generating' }

export type DataAction =
  | { type: 'set-snippets'; snippets: SnippetRecord[] }
  | { type: 'delete-snippet'; snippetId: string }

export type AutoCommitAction =
  | {
      type: 'auto-commit-generation-started'
      sessionId: string
      tabId: string
      workingTreeHash: string
      abortController: AbortController
      startedAt: number
    }
  | {
      type: 'auto-commit-generation-ready'
      sessionId: string
      workingTreeHash: string
      title: string
      body: string
      generatedAt: number
    }
  | { type: 'auto-commit-clear'; sessionId: string }

export type AppAction =
  | ModalAction
  | SessionAction
  | TabAction
  | LayoutAction
  | UIAction
  | DataAction
  | GitPanelAction
  | GitModeAction
  | AutoCommitAction

// ─── Side effects ─────────────────────────────────────────────────────────────

export type SideEffect =
  | { type: 'quit'; state: AppState }
  | { type: 'launch-selected-assistant' }
  | { type: 'edit-selected-assistant' }
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
  | { type: 'generate-auto-commit-now'; sessionId: string }
  | { type: 'git-push' }
  | { type: 'confirm-update-selection' }
  | { type: 'switch-session-by-index'; index: number }
  | { type: 'cycle-sidebar-item'; direction: 1 | -1 }
  | { type: 'switch-tab-by-index'; index: number }
  | { type: 'delete-session'; sessionId: string }
  | { type: 'delete-worktree'; sessionId: string; worktreeId: string; force?: boolean }
  | {
      type: 'move-worktree'
      sessionId: string
      sourceWorktreeId: string
      targetWorktreeId: string
      deleteSource?: boolean
    }
  | { type: 'toggle-transparent' }
  | { type: 'toggle-mode' }
  | { type: 'open-file-in-editor'; path: string }
  | { type: 'open-selected-snippet-source-in-editor' }

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
  onSessionCreate?: (session: { name: string; projectPath?: string }) => void | Promise<void>
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

export interface SessionBarConfig {
  /** Startup override for the session bar visibility. Reapplied on each launch. */
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
  sessionBar?: SessionBarConfig
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
  multiRepo?: Partial<MultiRepoConfig>
  statusBar?: StatusBarConfig
  externalEditor?: ExternalEditorConfig
  integrations?: AimuxIntegrationsConfig
  /**
   * Worktree templates: layouts (multi-pane + initial commands) applied at
   * worktree creation. Selected from a picker in the new-tab modal.
   */
  worktreeTemplates?: WorktreeTemplate[]
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
  sessionBar: {
    initialVisible?: boolean
  }
  gitPane:
    | {
        initialMode?: 'embedded'
        initialPosition?: 'top' | 'bottom'
        initialVisible?: boolean
        initialRatio?: number
        initialDiffModeRatio?: number
        initialFileListMode?: GitFileListMode
        initialTreeCompaction?: boolean
        path?: GitPanePathConfig
        diffCount?: GitPaneDiffCountConfig
        prefetchRadius?: number
      }
    | {
        initialMode: 'pane'
        initialPosition?: 'left' | 'right'
        initialVisible?: boolean
        initialRatio?: number
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
  multiRepo: MultiRepoConfig
  statusBar: StatusBarConfig
  externalEditor: ExternalEditorConfig
  integrations: {
    claudeHooks: boolean
  }
  worktreeTemplates: WorktreeTemplate[]
}

import type { ModeId, SnippetVar } from '@brimveyn/aimux-config'
import type { ThemedToken } from 'shiki'

export type BuiltinAssistantId = 'claude' | 'codex' | 'opencode' | 'terminal' | 'antigravity'

export type AssistantId = BuiltinAssistantId | (string & {})

export type TabStatus = 'starting' | 'running' | 'disconnected' | 'error'

/**
 * Status values that may appear in legacy on-disk workspace snapshots but are
 * not produced by the running app anymore. Filtered at restore time.
 */
export type LegacyPersistedTabStatus = TabStatus | 'exited'

export type TabActivity = 'working' | 'waiting-input' | 'idle'

/**
 * Per-session status flags. Both can be true at once (e.g. one tab working,
 * another waiting for user input) so we keep them as independent booleans
 * rather than a single priority enum.
 */
export interface SessionStatus {
  working: boolean
  waiting: boolean
}

export const IDLE_SESSION_STATUS: SessionStatus = { waiting: false, working: false }

export type FocusMode = 'navigation' | 'terminal-input' | 'modal' | 'command-edit' | 'git'

export type ModalType =
  | 'new-tab'
  | 'session-picker'
  | 'session-name'
  | 'create-session'
  | 'rename-tab'
  | 'snippet-picker'
  | 'snippet-editor'
  | 'theme-picker'
  | 'help'
  | 'split-picker'
  | 'git-commit'
  | 'update-available'
  | 'ai-usage'
  | null

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

export type ScrollIntent = { kind: 'bottom' } | { absoluteLine: number; kind: 'anchor' }

export const DEFAULT_SCROLL_INTENT: ScrollIntent = { kind: 'bottom' }

export function deriveScrollIntent(viewport: TerminalSnapshot): ScrollIntent {
  return viewport.viewportY >= viewport.baseY
    ? { kind: 'bottom' }
    : { absoluteLine: viewport.viewportY, kind: 'anchor' }
}

export interface TerminalModeState {
  mouseTrackingMode: 'none' | 'x10' | 'vt200' | 'drag' | 'any'
  sendFocusMode: boolean
  alternateScrollMode: boolean
  isAlternateBuffer: boolean
  bracketedPasteMode: boolean
}

export interface PersistedTabSnapshot {
  id: string
  assistant: AssistantId
  title: string
  command: string
  status: Exclude<LegacyPersistedTabStatus, 'disconnected'>
  buffer: string
  viewport?: TerminalSnapshot
  terminalModes: TerminalModeState
  scrollIntent?: ScrollIntent
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
  layoutTree?: import('./layout-tree').LayoutNode
  layoutTrees?: Record<string, import('./layout-tree').LayoutNode>
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

export type SessionBarPosition = 'top' | 'bottom'

export interface SessionBarState {
  visible: boolean
  position: SessionBarPosition
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
  scrollIntent?: ScrollIntent
  command: string
  errorMessage?: string
  exitCode?: number
  worktreeId?: string
}

export interface SidebarState {
  visible: boolean
  width: number
  minWidth: number
  maxWidth: number
}

export type GitPaneMode = 'embedded' | 'pane'
export type GitPanePosition = 'top' | 'bottom' | 'left' | 'right'

export type GitPanePathConfig =
  | { enabled: false }
  | { enabled: true; pathFn?: (path: string) => string }

export type GitPaneDiffCountConfig = { enabled: boolean }

export interface GitPaneState {
  visible: boolean
  mode: GitPaneMode
  position: GitPanePosition
  paneRatio: number
  embeddedRatio: number
  diffModeRatio: number
  fileListMode: GitFileListMode
  treeCompaction: boolean
  path: GitPanePathConfig
  diffCount: GitPaneDiffCountConfig
  /** Prefetch this many neighbours around the selection. 0 disables prefetch. */
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
  /** Absolute path to the originating git repo. Set when the entry comes from a sub-repo. */
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

export interface ParsedDiffEntry {
  hash: string
  // Stored as unknown at the state boundary and narrowed at read sites.
  file: unknown
}

export interface HighlightsEntry {
  hash: string
  themeId: string
  // See ParsedDiffEntry note — narrowed via getHighlights().
  add: unknown
  del: unknown
}

export function getParsedPayload<T>(entry: ParsedDiffEntry | undefined): T | null {
  if (!entry) return null
  return entry.file as T | null
}

export function getHighlightsTokens(entry: HighlightsEntry | undefined): {
  add: ThemedToken[][]
  del: ThemedToken[][]
} | null {
  if (!entry) return null
  return {
    add: entry.add as ThemedToken[][],
    del: entry.del as ThemedToken[][],
  }
}

export interface GitModeState {
  selectedEntryKey: string | null
  collapsedFolders: Record<string, true>
  diffs: Record<string, DiffData>
  /** Parsed diff keyed by fileKey. Invalidated on file change or head offset shift. */
  parsedFiles: Record<string, ParsedDiffEntry>
  /** Tokenised highlights keyed by `${fileKey}|${themeId}`. */
  highlights: Record<string, HighlightsEntry>
  loading: Record<string, boolean>
  pendingDeletePath: string | null
  actionMessage: string | null
  diffView: GitDiffView
  folds: Record<string, Record<string, FoldState>>
  /** Working-tree-vs-HEAD~N offset. 0 = working tree vs HEAD (default). */
  headOffset: number
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
  step: 'assistant' | 'worktree' | 'worktree-create'
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
  /**
   * Transient status line shown at the bottom of the picker (e.g. error from
   * an open-in-editor attempt). Cleared automatically when the modal closes.
   */
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
  splitDirection: import('./layout-tree').SplitDirection
}

export interface ModalGitCommit extends ModalBase {
  type: 'git-commit'
  activeField: 'title' | 'body'
  contentBuffer: string
  stage: 'edit' | 'generating' | 'confirm'
}

export interface ModalCreateSession extends ModalBase {
  type: 'create-session'
  directoryResults: DirectoryResult[]
  pendingProjectPath: string | null
  activeField: 'directory' | 'name'
  nameBuffer: string
  returnToSessionPicker: boolean
}

export interface ModalSnippetEditor extends ModalBase {
  type: 'snippet-editor'
  activeField: 'name' | 'trigger' | 'content'
  /** Persisted value of the name field when it is not the active editor. */
  nameBuffer: string
  /** Persisted value of the trigger field when it is not the active editor. */
  triggerBuffer: string
  /** Persisted value of the content field when it is not the active editor. */
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

export type DirectoryResultType = 'git-repo' | 'worktree' | 'workspace'

export interface DirectoryResult {
  path: string
  type: DirectoryResultType
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

export interface LayoutState {
  terminalCols: number
  terminalRows: number
}

export interface SnippetRecord {
  id: string
  name: string
  content: string
  trigger?: string
  vars?: Record<string, SnippetVar>
}

export interface DiscoveredRepo {
  /** Absolute path to the repo. */
  path: string
  /** Label shown in UI (relative to the workspace root or repo basename). */
  name: string
  /** True when the repo is the session's projectPath itself. */
  isRoot: boolean
}

export interface MultiRepoState {
  /** Discovered sub-repos, ordered so root (if any) comes first. */
  repos: DiscoveredRepo[]
  /** Precomputed disambiguating prefix per repo path — empty string for the root repo. */
  prefixes: Record<string, string>
}

export const EMPTY_MULTI_REPO_STATE: MultiRepoState = { prefixes: {}, repos: [] }

export interface AppState {
  tabs: TabSession[]
  activeTabId: string | null
  layoutTrees: Record<string, import('./layout-tree').LayoutNode>
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
  /** Chord prefix the sequence resolver is currently waiting on, or null when idle. */
  pendingChords: string[] | null
}

// -- Modal actions --
export type ModalAction =
  | { type: 'move-modal-cursor'; delta?: number; to?: 'home' | 'end' }
  | { type: 'open-new-tab-modal' }
  | { type: 'set-new-tab-branch-error'; message: string | null }
  | {
      type: 'set-new-tab-worktree-delete-state'
      confirmWorktreeId?: string | null
      message: string | null
    }
  | { type: 'enter-new-tab-worktree-create' }
  | { type: 'select-new-tab-assistant'; assistantId?: AssistantId }
  | { type: 'toggle-new-tab-worktree'; assistantId?: AssistantId }
  | { type: 'open-edit-custom-command'; assistantId: AssistantId }
  | { type: 'open-help-modal'; scope?: ModeId }
  | { type: 'open-split-picker'; direction: import('./layout-tree').SplitDirection }
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

// -- Session actions --
export type SessionAction =
  | { type: 'load-session'; sessionId: string; workspaceSnapshot?: WorkspaceSnapshotV1 }
  | { type: 'set-sessions'; sessions: SessionRecord[] }
  | { type: 'create-session-record'; session: SessionRecord }
  | { type: 'rename-session-record'; sessionId: string; name: string }
  | { type: 'delete-session-record'; sessionId: string; openSessionPicker?: boolean }
  | { type: 'reorder-sessions'; orderedIds: string[] }
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

// -- Tab actions --
export type TabAction =
  | { type: 'add-tab'; tab: TabSession }
  | {
      type: 'hydrate-workspace'
      tabs: TabSession[]
      activeTabId: string | null
      layoutTree?: import('./layout-tree').LayoutNode | null
      layoutTrees?: Record<string, import('./layout-tree').LayoutNode>
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
      source?: 'resize' | 'scroll' | 'data' | 'switch'
    }
  | { type: 'set-scroll-intent'; tabId: string; intent: ScrollIntent }
  | { type: 'set-tab-activity'; tabId: string; activity?: TabActivity }
  | { type: 'set-tab-error'; tabId: string; message: string }

// -- Layout actions --
export type LayoutAction =
  | {
      type: 'split-pane'
      direction: import('./layout-tree').SplitDirection
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
      axis?: import('./layout-tree').SplitDirection
    }
  | {
      type: 'set-split-ratio'
      tabId: string
      ratio: number
      axis?: import('./layout-tree').SplitDirection
    }

// -- UI actions --
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
  | { type: 'set-git-pane-mode'; mode: GitPaneMode }
  | { type: 'set-git-pane-position'; position: GitPanePosition }
  | { type: 'set-pending-chords'; chords: string[] | null }
  | { type: 'toggle-session-bar' }
  | { type: 'set-session-bar-position'; position: SessionBarPosition }

// -- Git panel actions --
export interface GitRefreshPayload {
  branch: string | null
  ahead: number
  behind: number
  files: GitFileEntry[]
}

export type GitPanelAction =
  | { type: 'git-refresh-success'; payload: GitRefreshPayload }
  | { type: 'git-refresh-error'; kind: GitPanelError }
  | { type: 'git-panel-reset' }

// -- Auto-commit state & actions --
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

export const EMPTY_AUTO_COMMIT_STATE: AutoCommitState = { bySession: {} }

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
      add: Array<{ start: number; tokens: unknown }>
      del: Array<{ start: number; tokens: unknown }>
    }
  | { type: 'git-mode-invalidate-diffs'; paths: string[] }
  | { type: 'git-mode-set-loading'; key: string; loading: boolean }
  | { type: 'git-mode-set-pending-delete'; path: string | null }
  | { type: 'git-mode-clear-diff-cache'; path: string }
  | { type: 'git-mode-set-message'; message: string | null }
  | { type: 'snippet-picker-set-message'; message: string | null }
  | { type: 'git-mode-toggle-diff-view' }
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
  | { type: 'git-commit-use-background-suggestion'; sessionId: string }

// -- Data actions --
export type DataAction =
  | { type: 'set-snippets'; snippets: SnippetRecord[] }
  | { type: 'delete-snippet'; snippetId: string }
  | { type: 'set-custom-commands'; customCommands: Record<AssistantId, string> }

// -- Multi-repo actions --
export type MultiRepoAction =
  | { type: 'multi-repo-set-repos'; repos: DiscoveredRepo[] }
  | { type: 'multi-repo-clear' }

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
  | MultiRepoAction

export type BuiltinAssistantId = 'claude' | 'codex' | 'opencode' | 'terminal'

export type AssistantId = BuiltinAssistantId | (string & {})

export type TabStatus = 'starting' | 'running' | 'disconnected' | 'exited' | 'error'

export type TabActivity = 'busy' | 'idle'

export type FocusMode =
  | 'navigation'
  | 'terminal-input'
  | 'modal'
  | 'command-edit'
  | 'layout'
  | 'git'

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

export interface PersistedTabSnapshot {
  id: string
  assistant: AssistantId
  title: string
  command: string
  status: Exclude<TabStatus, 'disconnected'>
  buffer: string
  viewport?: TerminalSnapshot
  terminalModes: TerminalModeState
  errorMessage?: string
  exitCode?: number
}

export interface WorkspaceSnapshotV1 {
  version: 1
  savedAt: string
  activeTabId: string | null
  sidebar: {
    visible: boolean
    width: number
    gitPanelVisible?: boolean
    gitPanelRatio?: number
  }
  tabs: PersistedTabSnapshot[]
  layoutTree?: import('./layout-tree').LayoutNode
  layoutTrees?: Record<string, import('./layout-tree').LayoutNode>
  tabGroupMap?: Record<string, string>
}

export interface SessionRecord {
  id: string
  name: string
  projectPath?: string
  createdAt: string
  updatedAt: string
  lastOpenedAt: string
  workspaceSnapshot?: WorkspaceSnapshotV1
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
}

export interface SidebarState {
  visible: boolean
  width: number
  minWidth: number
  maxWidth: number
  gitPanelVisible: boolean
  gitPanelRatio: number
}

export type GitFileStatus = 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?'

export type GitFileSection = 'staged' | 'unstaged' | 'untracked'

export interface GitFileEntry {
  path: string
  renamedFrom?: string
  section: GitFileSection
  status: GitFileStatus
  added: number | null
  removed: number | null
}

export type GitPanelError = 'not-a-repo' | 'unknown'

export interface GitPanelState {
  branch: string | null
  ahead: number
  behind: number
  files: GitFileEntry[]
  error: GitPanelError | null
}

export type DiffFileStatus = 'modified' | 'new' | 'deleted' | 'binary' | 'renamed'

export interface DiffData {
  path: string
  status: DiffFileStatus
  oldPath?: string
  rawDiff: string
  binarySizeBefore?: number
  binarySizeAfter?: number
  errorMessage?: string
}

export interface GitModeState {
  selectedFileIndex: number
  diffs: Record<string, DiffData>
  loading: Record<string, boolean>
  pendingDeletePath: string | null
  actionMessage: string | null
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
}

export interface ModalSessionPicker extends ModalBase {
  type: 'session-picker'
}

export interface ModalSessionName extends ModalBase {
  type: 'session-name'
}

export interface ModalRenameTab extends ModalBase {
  type: 'rename-tab'
}

export interface ModalSnippetPicker extends ModalBase {
  type: 'snippet-picker'
}

export interface ModalThemePicker extends ModalBase {
  type: 'theme-picker'
}

export interface ModalHelp extends ModalBase {
  type: 'help'
}

export interface ModalSplitPicker extends ModalBase {
  type: 'split-picker'
  splitDirection: import('./layout-tree').SplitDirection
}

export interface ModalGitCommit extends ModalBase {
  type: 'git-commit'
  activeField: 'title' | 'body'
  contentBuffer: string
}

export interface ModalCreateSession extends ModalBase {
  type: 'create-session'
  directoryResults: DirectoryResult[]
  pendingProjectPath: string | null
  activeField: 'directory' | 'name'
  nameBuffer: string
}

export interface ModalSnippetEditor extends ModalBase {
  type: 'snippet-editor'
  activeField: 'name' | 'content'
  contentBuffer: string
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

export interface LayoutState {
  terminalCols: number
  terminalRows: number
}

export interface SnippetRecord {
  id: string
  name: string
  content: string
}

export interface AppState {
  tabs: TabSession[]
  activeTabId: string | null
  layoutTrees: Record<string, import('./layout-tree').LayoutNode>
  tabGroupMap: Record<string, string>
  sessions: SessionRecord[]
  currentSessionId: string | null
  snippets: SnippetRecord[]
  focusMode: FocusMode
  sidebar: SidebarState
  modal: ModalState
  layout: LayoutState
  customCommands: Record<AssistantId, string>
  gitPanel: GitPanelState
  gitMode: GitModeState
}

// -- Modal actions --
export type ModalAction =
  | { type: 'move-modal-cursor'; delta?: number; to?: 'home' | 'end' }
  | { type: 'open-new-tab-modal' }
  | { type: 'open-help-modal' }
  | { type: 'open-split-picker'; direction: import('./layout-tree').SplitDirection }
  | { type: 'open-session-picker' }
  | { type: 'open-session-name-modal'; sessionTargetId?: string; initialName?: string }
  | { type: 'close-modal' }
  | { type: 'move-modal-selection'; delta: number }
  | { type: 'begin-command-edit' }
  | { type: 'update-command-edit'; char: string }
  | { type: 'commit-command-edit' }
  | { type: 'cancel-command-edit' }
  | { type: 'open-create-session-modal' }
  | { type: 'set-directory-results'; results: DirectoryResult[] }
  | { type: 'switch-create-session-field' }
  | { type: 'select-directory' }
  | { type: 'begin-session-filter' }
  | { type: 'open-rename-tab-modal' }
  | { type: 'open-snippet-picker' }
  | { type: 'open-snippet-editor'; snippetId?: string }
  | { type: 'begin-snippet-filter' }
  | { type: 'open-theme-picker' }

// -- Session actions --
export type SessionAction =
  | { type: 'load-session'; sessionId: string; workspaceSnapshot?: WorkspaceSnapshotV1 }
  | { type: 'set-sessions'; sessions: SessionRecord[] }
  | { type: 'create-session-record'; session: SessionRecord }
  | { type: 'rename-session-record'; sessionId: string; name: string }
  | { type: 'delete-session-record'; sessionId: string }

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
    }
  | { type: 'set-tab-activity'; tabId: string; activity?: TabActivity }
  | { type: 'set-tab-status'; tabId: string; status: TabStatus; exitCode?: number }
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
  | { type: 'set-focus-mode'; focusMode: FocusMode }
  | { type: 'set-terminal-size'; cols: number; rows: number }
  | { type: 'toggle-git-panel' }
  | { type: 'resize-git-panel'; delta: number }

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

export type GitModeAction =
  | { type: 'enter-git-mode' }
  | { type: 'exit-git-mode' }
  | { type: 'git-mode-select-file'; delta: -1 | 1 }
  | { type: 'git-mode-set-diff'; path: string; diff: DiffData }
  | { type: 'git-mode-set-loading'; path: string; loading: boolean }
  | { type: 'git-mode-set-pending-delete'; path: string | null }
  | { type: 'git-mode-clear-diff-cache'; path: string }
  | { type: 'git-mode-set-message'; message: string | null }
  | {
      type: 'git-mode-optimistic-move'
      path: string
      fromSection: GitFileSection
      toSection: GitFileSection | null
    }
  | { type: 'open-git-commit-modal' }

// -- Data actions --
export type DataAction =
  | { type: 'set-snippets'; snippets: SnippetRecord[] }
  | { type: 'delete-snippet'; snippetId: string }

export type AppAction =
  | ModalAction
  | SessionAction
  | TabAction
  | LayoutAction
  | UIAction
  | DataAction
  | GitPanelAction
  | GitModeAction

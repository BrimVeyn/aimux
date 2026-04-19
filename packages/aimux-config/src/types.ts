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
  | 'modal.theme-picker.filtering'
  | 'modal.help'
  | 'modal.help.filtering'
  | 'modal.split-picker'
  | 'modal.git-commit'
  | 'modal.update-available'

// ─── Primitive app types ──────────────────────────────────────────────────────

export type BuiltinAssistantId = 'claude' | 'codex' | 'opencode' | 'terminal'
export type AssistantId = BuiltinAssistantId | (string & {})
export type TabStatus = 'starting' | 'running' | 'disconnected' | 'exited' | 'error'
export type TabActivity = 'working' | 'waiting-input' | 'idle'
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

export type LayoutLeaf = { type: 'leaf'; tabId: string }
export type LayoutSplit = {
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
  }
  tabs: PersistedTabSnapshot[]
  layoutTree?: LayoutNode
  layoutTrees?: Record<string, LayoutNode>
  tabGroupMap?: Record<string, string>
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

export interface SnippetRecord {
  id: string
  name: string
  content: string
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
  ratio: number
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
}
export interface ModalGitCommit extends ModalBase {
  type: 'git-commit'
  activeField: 'title' | 'body'
  contentBuffer: string
}
export interface ModalSnippetEditor extends ModalBase {
  type: 'snippet-editor'
  activeField: 'name' | 'content'
  contentBuffer: string
}

export interface ModalUpdateAvailable extends ModalBase {
  type: 'update-available'
  currentVersion: string
  latestVersion: string
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

export interface LayoutState {
  terminalCols: number
  terminalRows: number
}

export type SessionBarPosition = 'top' | 'bottom'

export interface SessionBarState {
  visible: boolean
  position: SessionBarPosition
}

export interface AppState {
  tabs: TabSession[]
  activeTabId: string | null
  layoutTrees: Record<string, LayoutNode>
  tabGroupMap: Record<string, string>
  sessions: SessionRecord[]
  currentSessionId: string | null
  sessionStatuses: Record<string, TabActivity>
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
  pendingChords: string[] | null
}

// ─── AppAction union ──────────────────────────────────────────────────────────

export type ModalAction =
  | { type: 'open-new-tab-modal' }
  | { type: 'open-help-modal'; scope?: ModeId }
  | { type: 'open-split-picker'; direction: SplitDirection }
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
  | { type: 'begin-help-filter' }
  | { type: 'begin-theme-filter' }
  | { type: 'set-help-entry-count'; count: number }
  | { type: 'set-theme-entry-count'; count: number }
  | { type: 'open-theme-picker' }
  | { type: 'open-update-available-modal'; currentVersion: string; latestVersion: string }

export type SessionAction =
  | { type: 'load-session'; sessionId: string; workspaceSnapshot?: WorkspaceSnapshotV1 }
  | { type: 'set-sessions'; sessions: SessionRecord[] }
  | { type: 'create-session-record'; session: SessionRecord }
  | { type: 'rename-session-record'; sessionId: string; name: string }
  | { type: 'delete-session-record'; sessionId: string }
  | { type: 'reorder-sessions'; orderedIds: string[] }
  | { type: 'set-session-status'; sessionId: string; status: TabActivity }

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
  | { type: 'set-tab-status'; tabId: string; status: TabStatus; exitCode?: number }
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
  | { type: 'set-focus-mode'; focusMode: FocusMode }
  | { type: 'set-terminal-size'; cols: number; rows: number }
  | { type: 'toggle-git-pane' }
  | { type: 'resize-git-pane'; delta: number }
  | { type: 'resize-git-diff-pane'; delta: number }
  | { type: 'set-git-pane-mode'; mode: 'embedded' | 'pane' }
  | { type: 'set-git-pane-position'; position: 'top' | 'bottom' | 'left' | 'right' }
  | { type: 'set-pending-chords'; chords: string[] | null }
  | { type: 'toggle-session-bar' }
  | { type: 'set-session-bar-position'; position: SessionBarPosition }

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
  | {
      type: 'git-mode-optimistic-move'
      path: string
      fromSection: GitFileSection
      toSection: GitFileSection | null
    }
  | { type: 'open-git-commit-modal' }

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

// ─── Side effects ─────────────────────────────────────────────────────────────

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
  | { type: 'split-pane'; direction: SplitDirection }
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
  | { type: 'confirm-update-selection' }
  | { type: 'switch-session-by-index'; index: number }

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

import type { BundledTheme } from 'shiki'

export type ThemeId = BundledTheme | (string & {})

/**
 * VSCode workbench color keys aimux's UI depends on. The build-time normalizer
 * guarantees every `Theme` has all of these populated.
 */
export const AIMUX_COLOR_KEYS = [
  // editor
  'editor.background',
  'editor.foreground',
  'editor.lineHighlightBackground',
  'editor.selectionBackground',
  'editorLineNumber.foreground',
  'editorCursor.foreground',
  // sidebar / panels
  'sideBar.background',
  'sideBar.foreground',
  'sideBarSectionHeader.background',
  'sideBarSectionHeader.foreground',
  'editorGroupHeader.tabsBackground',
  'editorWidget.background',
  'panel.background',
  'panel.border',
  // borders & focus
  'focusBorder',
  'editorGroup.border',
  'contrastBorder',
  // lists
  'list.activeSelectionBackground',
  'list.activeSelectionForeground',
  'list.hoverBackground',
  // text & links
  'foreground',
  'descriptionForeground',
  'textLink.foreground',
  'textLink.activeForeground',
  // status
  'errorForeground',
  'editorError.foreground',
  'editorWarning.foreground',
  // terminal ANSI
  'terminal.ansiRed',
  'terminal.ansiGreen',
  'terminal.ansiYellow',
  'terminal.ansiBlue',
  'terminal.ansiMagenta',
  'terminal.ansiCyan',
  // git decorations
  'gitDecoration.addedResourceForeground',
  'gitDecoration.modifiedResourceForeground',
  'gitDecoration.deletedResourceForeground',
  'gitDecoration.untrackedResourceForeground',
  // diff editor
  'diffEditor.insertedLineBackground',
  'diffEditor.removedLineBackground',
  // input
  'input.background',
  'input.foreground',
  'input.border',
] as const

export type AimuxColorKey = (typeof AIMUX_COLOR_KEYS)[number]

export type ThemeColorMap = Record<AimuxColorKey, string> & Record<string, string>

export interface ThemeSettings {
  fontStyle?: string
  foreground?: string
  background?: string
  // Some bundled shiki themes include non-standard keys (e.g. `content`); allow passthrough.
  [key: string]: string | undefined
}

export interface ThemeTokenRule {
  name?: string
  scope?: string | string[]
  // `foreground` at the top level is used by a handful of shiki themes as a
  // shorthand for `settings.foreground` — accept both forms.
  foreground?: string
  settings?: ThemeSettings
}

export interface Theme {
  name: string
  displayName: string
  type: 'dark' | 'light'
  fg: string
  bg: string
  colors: ThemeColorMap
  settings: ThemeTokenRule[]
  tokenColors?: ThemeTokenRule[]
  colorReplacements?: Record<string, string>
  semanticHighlighting?: boolean
  semanticTokenColors?: Record<
    string,
    | string
    | {
        foreground?: string
        fontStyle?: string
        bold?: boolean
        italic?: boolean
        underline?: boolean
      }
  >
}

/** Partial-override shape for `themes.define(name, base, overrides)`. */
export interface ThemeDefinition {
  base?: ThemeId
  colors: Partial<ThemeColorMap>
}

export interface NamedThemeDefinition extends ThemeDefinition {
  name: string
}

export interface NamedTheme extends Theme {
  displayName: string
}

/**
 * Input shape accepted by `themes.full(...)` — lets users paste a shiki /
 * VSCode theme JSON without typing every AIMUX_COLOR_KEY. `registerUserThemes`
 * runs it through `normalizeTheme` to produce a complete `Theme`.
 */
export interface UserThemeInput extends Partial<Omit<Theme, 'colors' | 'name' | 'displayName'>> {
  name: string
  displayName: string
  colors?: Partial<ThemeColorMap> & Record<string, string | undefined>
}

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

export interface SnippetDef {
  name: string
  trigger?: string
  text: string
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
  visible?: boolean
  position?: SessionBarPosition
}

// ─── Git pane config (discriminated union) ────────────────────────────────────

export type GitPanePathConfig =
  | { enabled: false }
  | { enabled: true; pathFn?: (path: string) => string }

export type GitPaneDiffCountConfig = { enabled: boolean }

interface GitPaneBaseConfig {
  visible?: boolean
  ratio?: number
  diffModeRatio?: number
  fileListMode?: GitFileListMode
  treeCompaction?: boolean
  path?: GitPanePathConfig
  diffCount?: GitPaneDiffCountConfig
  /** Prefetch N neighbouring diffs around the cursor; 0 disables. */
  prefetchRadius?: number
}

export interface GitPaneEmbeddedConfig extends GitPaneBaseConfig {
  mode?: 'embedded'
  position?: 'top' | 'bottom'
}

export interface GitPanePaneConfig extends GitPaneBaseConfig {
  mode: 'pane'
  position?: 'left' | 'right'
}

export type GitPaneConfig = GitPaneEmbeddedConfig | GitPanePaneConfig

export interface AimuxUserConfig {
  theme?: ThemeId
  themes?: Record<string, NamedThemeDefinition | UserThemeInput>
  keymaps?: (k: KeymapBuilderApi) => KeymapBuilderApi
  backends?: Record<string, BackendConfig>
  sidebar?: SidebarConfig
  sessionBar?: SessionBarConfig
  gitPane?: GitPaneConfig
  hooks?: HooksConfig
  snippets?: SnippetDef[]
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
  theme: ThemeId | undefined
  themes: Record<string, NamedThemeDefinition | UserThemeInput>
  keymaps: ResolvedKeymapConfig
  backends: Record<string, BackendConfig>
  sidebar: SidebarConfig
  sessionBar: SessionBarConfig
  gitPane: GitPaneConfig
  hooks: HooksConfig
  snippets: SnippetDef[]
}

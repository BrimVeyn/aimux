// Canonical wire-level types projected from the host's AppState into the GUI
// renderer. Naming convention: `*Lite` suffixes are kept to minimise churn at
// the import sites; they may be renamed in a follow-up. Treat the unsuffixed
// names (AppStateProjection, ProjectedTab, ModalProjection, etc.) as the
// "explicit contract" — anything the host wants the renderer to see must be
// listed here. Fields the renderer never reads do NOT belong on the wire.

export type SplitDirection = 'horizontal' | 'vertical'

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

export type TabActivity = 'working' | 'waiting-input' | 'idle'
export type TabStatus = 'starting' | 'running' | 'disconnected' | 'error'
export type FocusMode =
  | 'navigation'
  | 'terminal-input'
  | 'modal'
  | 'command-edit'
  | 'git'
  | 'settings'
  | 'stats'

export interface ProjectStatus {
  working: boolean
  waiting: boolean
}

/** A workspace's aggregated assistant state, as the sidebar draws it. */
export interface WorkspaceActivity {
  working: boolean
  waiting: boolean
  done: boolean
}

export interface ProjectedTab {
  id: string
  title: string
  command: string
  assistant: string
  status: TabStatus
  activity?: TabActivity
  /** The tab rang while you were looking elsewhere. Drawn as a dot. */
  unseen?: boolean
  /** Its PTY was released; the workspace row marks it with a `z`. */
  hibernated?: boolean
  /** Filtered out of every strip and list — see `filterTabsForActiveWorkspace`. */
  hidden?: boolean
  /**
   * Workspace the tab lives in. The tab strip shows the ACTIVE workspace's
   * tabs only, so without this the renderer cannot filter and would show
   * every tab of every workspace at once.
   */
  workspaceId?: string
}

export interface WorkspaceLite {
  id: string
  name: string
  baseRef?: string
  branch?: string
  color?: string
  commitSha?: string
  createdAt?: string
  createdByAimux?: boolean
  path?: string
  repoRoot?: string
  source?: 'primary' | 'aimux-temp' | 'external'
  updatedAt?: string
}

export interface ProjectRecordLite {
  id: string
  name: string
  activeWorkspaceId?: string
  projectPath?: string
  workspaces?: WorkspaceLite[]
  /** Folded in the sidebar: only the active workspace shows, and only if current. */
  collapsed?: boolean
}

export interface GuiHelpEntry {
  keys: string
  keysDisplay: string
  description: string
  group: string
  modeLabel: string
}

/** One run of status-bar text with its tone. */
export interface IdentitySegment {
  id: string
  text: string
  tone: 'primary' | 'muted'
}

// Mirror of the host's status-bar model plus the app version. The host owns the
// keymap config, so it computes right/help; the identity breadcrumb arrives as
// real segments, which is why the renderer no longer splits a string on a
// nerd-font glyph to rebuild it.
export interface StatusBarProjection {
  projectSegments: IdentitySegment[]
  right: string
  help: string
  version: string
}

export type AIUsageTool = 'claude' | 'codex'

export type UsageWindowKind = 'session' | 'weekly' | 'sonnet' | 'opus' | 'primary' | 'secondary'

export type UsagePaceStage =
  | 'farAhead'
  | 'ahead'
  | 'slightlyAhead'
  | 'onTrack'
  | 'slightlyBehind'
  | 'behind'
  | 'farBehind'

export interface UsagePace {
  delta: number
  stage: UsagePaceStage
  label: string
  rightText: string | null
}

export interface UsageWindow {
  kind: UsageWindowKind
  label: string
  percent: number | null
  resetAt: string | null
  timeRemaining: string | null
  windowSeconds: number | null
  pace: UsagePace | null
}

export interface UsageSnapshot {
  tool: AIUsageTool
  percent: number | null
  tokens: { input: number; output: number; cache: number; total: number }
  costUSD: number | null
  resetAt: string | null
  timeRemaining: string | null
  burnRatePerHour: number | null
  lastUpdated: string
  planTier: string | null
  windows: UsageWindow[]
  error?: string
  stale?: boolean
}

export interface AIUsageProjection {
  enabled: boolean
  snapshots: Partial<Record<AIUsageTool, UsageSnapshot>>
}

export interface SnippetRecordLite {
  id: string
  name: string
  content: string
  trigger?: string
}

export interface DirectoryResultLite {
  path: string
  type: 'git-repo' | 'worktree' | 'workspace'
}

export interface GitFileEntryLite {
  added?: number
  oldPath?: string
  path: string
  removed?: number
  repoPath?: string
  section: 'historical' | 'staged' | 'unstaged' | 'untracked'
  status: '?' | 'A' | 'C' | 'R' | 'D' | 'U' | 'M'
}

export interface GitPanelLite {
  ahead: number
  behind: number
  branch: string | null
  error: 'not-a-repo' | 'unknown' | null
  files: GitFileEntryLite[]
}

/**
 * Browser-side mirror of aimux's `DiffData`. Diverges from the host type only
 * in the image byte fields: the host stores `Uint8Array`, but the projection
 * rewrites them to base64 strings before emit so they survive JSON
 * serialization. The base64 string drops straight into
 * `<img src="data:image/<mime>;base64,...">`.
 */
export interface DiffDataLite {
  binarySizeAfter?: number
  binarySizeBefore?: number
  errorMessage?: string
  imageBytesAfter?: string
  imageBytesBefore?: string
  imageFormatLabel?: string
  imageMime?: string
  oldPath?: string
  path: string
  rawDiff: string
  // Mirrors `DiffFileStatus`: 'modified' | 'new' | 'deleted' | 'binary' | 'renamed' | 'image'.
  status: 'modified' | 'new' | 'deleted' | 'binary' | 'renamed' | 'image'
}

export interface FoldStateLite {
  bottom: number
  top: number
}

/**
 * `parsedFiles[k].file` and `highlights[k].add/del` stay `unknown` — they're
 * deep tree-of-tokens structures from `prepareDiff` / shiki. Narrow at read
 * sites in the desktop components.
 */
export interface GitModeLite {
  actionMessage: string | null
  collapsedFolders: Record<string, true>
  diffs: Record<string, DiffDataLite>
  diffView: 'split' | 'stacked'
  folds: Record<string, Record<string, FoldStateLite>>
  headOffset: number
  highlights: Record<string, { add: unknown; del: unknown; hash: string; themeId: string }>
  loading: Record<string, boolean>
  parsedFiles: Record<string, { file: unknown; hash: string }>
  pendingDeletePath: string | null
  reviewBase: boolean
  selectedEntryKey: string | null
}

/**
 * The git pane stopped being a positioned, toggleable pane: it is a widget
 * inside a bar (see `BarLite.widgets`), and git mode replaces the pane tree
 * outright. What is left here is how the diff itself is drawn.
 */
export interface GitPaneLite {
  diffCount: { enabled: boolean }
  // Width fraction the file list takes inside the full-screen git-mode view.
  diffModeRatio: number
  fileListMode: 'tree' | 'flat'
  treeCompaction: boolean
  /** Prefetch this many neighbours around the selection. 0 disables prefetch. */
  prefetchRadius: number
}

/** A widget stacked inside a bar. Known ids: `projects`, `git`, `setup`. */
export interface BarWidgetLite {
  id: string
  grow: number
  visible: boolean
}

export interface BarLite {
  visible: boolean
  width: number
  /** Ordered top → bottom. */
  widgets: BarWidgetLite[]
}

export interface MultiRepoLite {
  prefixes: Record<string, string>
  repos: { isRoot: boolean; name: string; path: string }[]
}

/** Loose view of aimux's ModalState (only the fields the GUI renders so far). */
export interface ModalProjection {
  // `type` is open-ended: includes "new-tab", "project-picker", "project-name",
  // "rename-tab", "rename-workspace", "snippet-picker", "split-picker",
  // "theme-picker", "workspace-move", "git-commit", "snippet-editor",
  // "settings-search", "setting-text", "update-available", etc.
  type: string | null
  editBuffer: string | null
  selectedIndex: number
  actionMessage?: string | null
  activeField?:
    | 'directory'
    | 'name'
    | 'title'
    | 'body'
    | 'trigger'
    | 'content'
    | 'workspace-name'
    | 'branch-name'
    | 'target-workspace'
    | 'assistant'
  branchName?: string
  createWorkspace?: boolean
  // workspace-move specific fields
  deleteSource?: boolean
  directoryResults?: DirectoryResultLite[]
  nameBuffer?: string
  scope?: string | null
  selectedAssistantId?: string | null
  sourceWorkspaceId?: string
  step?: 'assistant' | 'workspace' | 'workspace-create'
  workspaceName?: string
  // git-commit (contentBuffer holds the inactive field) + snippet-editor (holds content when inactive)
  contentBuffer?: string | null
  // snippet-editor
  triggerBuffer?: string | null
  // git-commit (GUI renders edit + confirm only; generating is host-side only)
  stage?: 'edit' | 'generating' | 'confirm'
  // snippet-editor: null => "Create snippet", non-null => "Edit snippet"
  projectTargetId?: string | null
  // update-available
  currentVersion?: string
  latestVersion?: string
}

/** The slice of aimux's AppState the GUI renders (full state is streamed). */
export interface AppStateProjection {
  tabs: ProjectedTab[]
  activeTabId: string | null
  /** Already in display order — the renderer must not re-sort. */
  projects: ProjectRecordLite[]
  currentProjectId: string | null
  projectStatuses: Record<string, ProjectStatus>
  snippets: SnippetRecordLite[]
  focusMode: FocusMode
  modal: ModalProjection
  customCommands: Record<string, string>
  /**
   * Chrome that flanks the panes. Projects, git and setup are widgets stacked
   * inside these — there is no free-standing sidebar any more.
   */
  bars: { left: BarLite; right: BarLite }
  /** The tab strip above the panes. */
  projectBar: { visible: boolean }
  // `themeId` is the LIVE theme (reflects preview while the picker is open) and
  // drives the renderer's CSS. `committedThemeId` is the saved theme, used for
  // the "(current)" marker so it stays put while previewing.
  themeId: string
  committedThemeId: string
  themeMode: 'dark' | 'light'
  transparent: boolean
  gitMode: GitModeLite
  gitPane: GitPaneLite
  gitPanel: GitPanelLite
  helpEntries: GuiHelpEntry[]
  statusBar: StatusBarProjection
  aiUsage: AIUsageProjection
  layoutTrees: Record<string, LayoutNode>
  multiRepo: MultiRepoLite
  tabGroupMap: Record<string, string>
  /** Keyed by workspace id. `added`/`removed` are lines, working tree included. */
  workspaceDivergence: Record<
    string,
    { ahead: number; behind: number; added?: number; removed?: number }
  >
  /** Keyed by workspace id — what each workspace's assistants are doing. */
  workspaceActivity: Record<string, WorkspaceActivity>
}

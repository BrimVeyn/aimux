import type { ModeId, SnippetVar } from '@brimveyn/aimux-config'
import type { ThemedToken } from 'shiki'

import type { LayoutNode, SplitDirection } from './layout-tree'

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
 * not produced by the running app anymore. Filtered at restore time.
 */
export type LegacyPersistedTabStatus = TabStatus | 'exited'

export type TabActivity = 'working' | 'waiting-input' | 'idle'

/**
 * Classifies why a tab is blocked on user input. `permission` is a tool /
 * command approval prompt; `question` is any other prompt the assistant is
 * waiting on. Carried by the `tabQuestion` server event so an orchestrator can
 * branch without re-scraping the screen.
 */
export type QuestionKind = 'question' | 'permission'

/**
 * Per-project status flags. Both can be true at once (e.g. one tab working,
 * another waiting for user input) so we keep them as independent booleans
 * rather than a single priority enum.
 */
export interface ProjectStatus {
  working: boolean
  waiting: boolean
}

export const IDLE_PROJECT_STATUS: ProjectStatus = { waiting: false, working: false }

/**
 * A workspace's status, as the sidebar draws it. `working`/`waiting` mirror
 * `ProjectStatus` one level down; `done` is a latch — an assistant here
 * finished a turn and nobody has looked yet — cleared when the workspace is
 * entered or when it goes back to work.
 */
export interface WorkspaceActivity {
  working: boolean
  waiting: boolean
  done: boolean
}

export const IDLE_WORKSPACE_ACTIVITY: WorkspaceActivity = {
  done: false,
  waiting: false,
  working: false,
}

export type FocusMode =
  | 'navigation'
  | 'terminal-input'
  | 'modal'
  | 'command-edit'
  | 'git'
  | 'settings'

export type ModalType =
  | 'new-tab'
  | 'project-picker'
  | 'project-name'
  | 'create-project'
  | 'create-workspace'
  | 'rename-tab'
  | 'rename-workspace'
  | 'snippet-picker'
  | 'snippet-editor'
  | 'theme-picker'
  | 'help'
  | 'split-picker'
  | 'git-commit'
  | 'update-available'
  | 'ai-usage'
  | 'workspace-move'
  | 'workspace-move-confirm'
  | 'workspace-delete-confirm'
  | 'flash-jump'
  | 'setting-text'
  | 'settings-search'
  | null

export interface TerminalSpan {
  text: string
  /** Hex color for RGB cells, or undefined for the "default" foreground. */
  fg?: string
  /** Hex color for RGB cells, or undefined for the "default" background. */
  bg?: string
  /** ANSI palette index (0-255) when the cell emitted an indexed color.
   *  Resolved client-side against the host terminal's queried palette so
   *  user themes (Ghostty, iTerm2, …) show through. Wins over `fg` if set. */
  fgPalette?: number
  /** ANSI palette index (0-255). Resolved client-side. Wins over `bg`. */
  bgPalette?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  cursor?: boolean
}

export interface TerminalLine {
  spans: TerminalSpan[]
}

/** DECSCUSR cursor shape; 'default' restores the host terminal's configured cursor. */
export type TerminalCursorStyle = 'block' | 'underline' | 'bar' | 'default'

export interface TerminalSnapshot {
  lines: TerminalLine[]
  tailLines?: TerminalLine[]
  viewportY: number
  baseY: number
  cursorVisible: boolean
  cursorStyle?: TerminalCursorStyle
  /** Blink flag from DECSCUSR; undefined means "host terminal's default". */
  cursorBlink?: boolean
  /** Cursor row relative to the rendered viewport; outside [0, rows) when
   *  the user scrolled the viewport away from the active screen. */
  cursorRow?: number
  cursorCol?: number
}

// The scroll position is owned end-to-end by the backend emulator; this type
// only describes the re-anchor target the backend computes for itself across a
// reflow. The frontend no longer derives, stores, or sends a scroll intent.
export type ScrollIntent = { kind: 'bottom' } | { absoluteLine: number; kind: 'anchor' }

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
  errorMessage?: string
  exitCode?: number
  workspaceId?: string
  /** Stable project-scoped name assigned by the headless worker facade. */
  workerName?: string
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

export interface ProjectBarState {
  visible: boolean
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
  /**
   * This tab is the one that rang: it finished a turn while you were looking
   * elsewhere. Set alongside the workspace's own tick and cleared the moment
   * the tab is opened or goes back to work, so the notification points at
   * something rather than just happening. Ephemeral — never persisted, never
   * on the wire.
   */
  unseen?: boolean
  /** Stable project-scoped name assigned by the headless worker facade. */
  workerName?: string
  autoRenameStatus?: 'eligible' | 'attempted'
  /**
   * A real PTY tab that no chrome enumerates: absent from the top tab bar, from
   * tab navigation, from `activeTabId` picks, and from the persisted snapshot.
   * Rendered by whatever created it — today only the setup widget.
   * `filterTabsForActiveWorkspace` is the single guard the UI paths share.
   */
  hidden?: boolean
  /**
   * Who owns this tab. Separate from `hidden` on purpose: promoting a setup tab
   * into the main pane clears `hidden` but must not turn it back into an
   * ordinary tab, or the PTY exit would close it and take the failure output
   * with it — which is the one thing the promotion exists to read.
   *
   * ponytail: not on the ipc wire nor in the snapshot, so a promoted setup tab
   * comes back from a restart as a plain tab running `bash …/setup.sh`. Add it
   * to `TabSessionSummary` if that ever matters.
   */
  role?: 'setup'
}

export type BarSide = 'left' | 'right'

/**
 * One widget slot in a bar. `grow` is the flex weight opentui consumes
 * directly; hidden widgets keep their weight but are excluded from the layout.
 */
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

export type GitPanePathConfig =
  | { enabled: false }
  | { enabled: true; pathFn?: (path: string) => string }

export interface GitPaneDiffCountConfig {
  enabled: boolean
}

export interface GitPaneState {
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
  /** When true, diff the active workspace's working tree against its fork point. */
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

/**
 * Picking an assistant for a new tab, and nothing else. The tab lands in the
 * project's active workspace; creating a workspace is `create-workspace`'s job.
 */
export interface ModalNewTab extends ModalBase {
  type: 'new-tab'
  editingCommand: AssistantId | null
  /**
   * Set when `create-workspace` chained into this picker. The prompt the user
   * typed there is sent to the assistant and drives the workspace's real name,
   * and the tab is pinned to the freshly created workspace rather than the
   * project's active one. Living on the modal means `close-modal` clears it, so
   * escaping the picker cannot leak a stale prompt into a later tab.
   */
  pendingWorkspace?: PendingWorkspaceLaunch
  /**
   * A prompt to hand the picked assistant, with none of `pendingWorkspace`'s
   * other behaviour: no workspace pinning, no rename. Used by "Ask an agent" in
   * the setup widget.
   */
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
/**
 * One text field over a settings row. Carries the row it belongs to so confirming
 * writes back to the right one, and closing returns to the settings screen rather
 * than to the panes.
 */
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
  splitDirection: SplitDirection
}

export interface ModalGitCommit extends ModalBase {
  type: 'git-commit'
  activeField: 'title' | 'body'
  contentBuffer: string
  stage: 'edit' | 'generating' | 'confirm'
}

export interface ModalCreateProject extends ModalBase {
  type: 'create-project'
  directoryResults: DirectoryResult[]
  pendingProjectPath: string | null
  activeField: 'directory' | 'name'
  nameBuffer: string
  returnToProjectPicker: boolean
}

/**
 * Creating a workspace inside the current project — the second of the three
 * creation actions (project / workspace / tab). Deliberately carries no
 * assistant: once the workspace exists the effect chains into the new-tab modal.
 */
export interface ModalCreateWorkspace extends ModalBase {
  type: 'create-workspace'
  activeField: 'prompt' | 'base'
  /**
   * "What do you want to work on?" — the only thing the user types. It is sent
   * to the assistant, and it names both the workspace and its branch.
   */
  prompt: string
  branchError: string | null
  /** Filter text typed into the "Base" picker. */
  baseQuery: string
  /** Resolved base ref the new workspace is forked from (a workspace's branch or a local branch). */
  baseRef: string
  /** Local branches available as base refs, loaded when the modal opens. */
  baseBranches: string[]
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

export type DirectoryResultType = 'git-repo' | 'workspace' | 'project'

export interface DirectoryResult {
  path: string
  type: DirectoryResultType
}

export type FlashJumpTargetKind = 'project' | 'workspace' | 'tab'

export interface FlashJumpTarget {
  kind: FlashJumpTargetKind
  /**
   * 1-based index of the project in the visible project ordering — fed to
   * the existing `switch-project-by-index` side effect when jumping.
   */
  projectIndex: number
  projectId: string
  /** Set for kind 'workspace' (the non-primary target) and kind 'tab' (the tab's workspace). */
  workspaceId?: string
  /** Set for kind 'tab'. */
  tabId?: string
}

export interface FlashLabel {
  /** Stable identity of the labelled row (`ws:<id>`, `wt:<id>`, `tab:<id>`). */
  key: string
  /** 1- or 2-char lowercase ASCII label. */
  label: string
  target: FlashJumpTarget
}

export interface ModalFlashJump extends ModalBase {
  type: 'flash-jump'
  labels: FlashLabel[]
  /** Letters typed so far, narrowing the matching label set. */
  buffer: string
  /**
   * Set by the reducer once the buffer narrows to a single match — read by
   * app.tsx in a useEffect to perform the actual jump and close the modal.
   */
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
  | ModalAIUsage
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
  /** Label shown in UI (relative to the project root or repo basename). */
  name: string
  /** True when the repo is the project's projectPath itself. */
  isRoot: boolean
}

export interface MultiRepoState {
  /** Discovered sub-repos, ordered so root (if any) comes first. */
  repos: DiscoveredRepo[]
  /** Precomputed disambiguating prefix per repo path — empty string for the root repo. */
  prefixes: Record<string, string>
}

export const EMPTY_MULTI_REPO_STATE: MultiRepoState = { prefixes: {}, repos: [] }

/**
 * Where the cursor is in the settings screen. Only the cursor: the values being
 * edited live in `src/settings/settings-store.ts`, or already have a home in
 * this state (`gitPane`, `customCommands`, …). Duplicating them here would make
 * two of them.
 */
export interface SettingsUIState {
  sectionId: string
  /** Which of the two columns has the keyboard: the section list, or its rows. */
  pane: 'nav' | 'rows'
  rowIndex: number
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
  /**
   * Commits each workspace's branch is ahead/behind the ref it forked from,
   * keyed by workspace id. Ephemeral (polled); not persisted to the catalog.
   */
  workspaceDivergence: Record<string, BranchDivergence>
  /**
   * What each workspace's assistants are doing, keyed by workspace id. Covers
   * every project the daemon knows, not just the current one — see
   * `src/app-runtime/workspace-activity.ts`, which owns the aggregation.
   * Ephemeral; not persisted to the catalog.
   */
  workspaceActivity: Record<string, WorkspaceActivity>
  /**
   * Last active tab a user viewed within each workspace, keyed by workspace id.
   * Lets switching back to a workspace restore its last-viewed tab instead of
   * snapping to the first one. Ephemeral (in-memory); not persisted to the catalog.
   */
  lastActiveTabByWorkspace: Record<string, string>
  /** Chord prefix the sequence resolver is currently waiting on, or null when idle. */
  pendingChords: string[] | null
}

// -- Git panel payloads --
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

// -- Auto-commit state --
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

export const EMPTY_AUTO_COMMIT_STATE: AutoCommitState = { byProject: {} }

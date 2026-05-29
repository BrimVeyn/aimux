// Local mirror of the host contract (src/gui/protocol.ts) and the slice of
// aimux's AppState the renderer reads (src/gui/state-projection.ts). Kept local
// for Phase 1; later phases import shared TYPES from ../src via a path alias.

export interface TerminalSpan {
  text: string;
  fg?: string;
  bg?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  cursor?: boolean;
}

export interface TerminalLine {
  spans: TerminalSpan[];
}

export interface TerminalSnapshot {
  lines: TerminalLine[];
  tailLines?: TerminalLine[];
  viewportY: number;
  baseY: number;
  cursorVisible: boolean;
}

export interface TerminalModeState {
  mouseTrackingMode: "none" | "x10" | "vt200" | "drag" | "any";
  sendFocusMode: boolean;
  alternateScrollMode: boolean;
  isAlternateBuffer: boolean;
  bracketedPasteMode: boolean;
}

export type SplitDirection = "horizontal" | "vertical";

export interface LayoutLeaf {
  type: "leaf";
  tabId: string;
}

export interface LayoutSplit {
  type: "split";
  direction: SplitDirection;
  ratio: number;
  first: LayoutNode;
  second: LayoutNode;
}

export type LayoutNode = LayoutLeaf | LayoutSplit;

export type TabActivity = "working" | "waiting-input" | "idle";
export type TabStatus = "starting" | "running" | "disconnected" | "error";
export type FocusMode = "navigation" | "terminal-input" | "modal" | "command-edit" | "git";

export interface SessionStatus {
  working: boolean;
  waiting: boolean;
}

export interface ProjectedTab {
  id: string;
  title: string;
  command: string;
  assistant: string;
  status: TabStatus;
  activity?: TabActivity;
}

export interface WorktreeLite {
  id: string;
  name: string;
  baseRef?: string;
  branch?: string;
  color?: string;
  commitSha?: string;
  createdAt?: string;
  createdByAimux?: boolean;
  path?: string;
  repoRoot?: string;
  source?: "primary" | "aimux-temp" | "external";
  updatedAt?: string;
}

export interface SessionRecordLite {
  id: string;
  name: string;
  activeWorktreeId?: string;
  projectPath?: string;
  worktrees?: WorktreeLite[];
}

export interface GuiHelpEntry {
  keys: string;
  keysDisplay: string;
  description: string;
  group: string;
  modeLabel: string;
}

export interface SnippetRecordLite {
  id: string;
  name: string;
  content: string;
  trigger?: string;
}

export interface DirectoryResultLite {
  path: string;
  type: "git-repo" | "worktree" | "workspace";
}

export interface GitFileEntryLite {
  added?: number;
  oldPath?: string;
  path: string;
  removed?: number;
  repoPath?: string;
  section: "historical" | "staged" | "unstaged" | "untracked";
  status: "?" | "A" | "C" | "R" | "D" | "U" | "M";
}

export interface GitPanelLite {
  ahead: number;
  behind: number;
  branch: string | null;
  error: "not-a-repo" | "unknown" | null;
  files: GitFileEntryLite[];
}

export interface GitModeLite {
  // Stage 2a only needs these; diff-viewer fields stay untyped on the wire.
  collapsedFolders: Record<string, true>;
  headOffset: number;
  selectedEntryKey: string | null;
  [k: string]: unknown;
}

export interface GitPaneLite {
  diffCount: { enabled: boolean };
  embeddedRatio: number;
  fileListMode: "tree" | "flat";
  mode: "pane" | "embedded";
  paneRatio: number;
  position: "left" | "right" | "top" | "bottom";
  treeCompaction: boolean;
  visible: boolean;
}

export interface MultiRepoLite {
  prefixes: Record<string, string>;
  repos: { isRoot: boolean; name: string; path: string }[];
}

/** Loose view of aimux's ModalState (only the fields the GUI renders so far). */
export interface ModalProjection {
  // `type` is open-ended: includes "new-tab", "session-picker", "snippet-picker",
  // "split-picker", "theme-picker", "create-session", "worktree-move", etc.
  type: string | null;
  editBuffer: string | null;
  selectedIndex: number;
  // Phase 3 additions
  actionMessage?: string | null;
  activeField?: "directory" | "name";
  branchName?: string;
  createWorktree?: boolean;
  // worktree-move specific fields
  deleteSource?: boolean;
  directoryResults?: DirectoryResultLite[];
  nameBuffer?: string;
  scope?: string | null;
  selectedAssistantId?: string | null;
  sourceWorktreeId?: string;
  step?: "assistant" | "worktree" | "worktree-create";
  worktreeName?: string;
}

/** The slice of aimux's AppState the GUI renders (full state is streamed). */
export interface AppStateProjection {
  tabs: ProjectedTab[];
  activeTabId: string | null;
  sessions: SessionRecordLite[];
  currentSessionId: string | null;
  sessionStatuses: Record<string, SessionStatus>;
  snippets: SnippetRecordLite[];
  focusMode: FocusMode;
  modal: ModalProjection;
  customCommands: Record<string, string>;
  sidebar: { visible: boolean; width: number };
  sessionBar: { visible: boolean; position: "top" | "bottom" };
  themeId: string;
  committedThemeId: string;
  themeMode: "dark" | "light";
  transparent: boolean;
  gitMode: GitModeLite;
  gitPane: GitPaneLite;
  gitPanel: GitPanelLite;
  helpEntries: GuiHelpEntry[];
  layoutTrees: Record<string, LayoutNode>;
  multiRepo: MultiRepoLite;
  tabGroupMap: Record<string, string>;
  worktreeDivergence: Record<string, { ahead: number; behind: number }>;
}

/** Normalized keyboard event in aimux's KeyInput shape. */
export interface KeyPayload {
  name: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  sequence: string;
}

export type GuiClientMessage =
  | ({ t: "key" } & KeyPayload)
  | { t: "paste"; text: string }
  | { t: "scroll"; deltaLines: number }
  | { t: "resizeWindow"; cols: number; rows: number }
  | { t: "resizeTab"; tabId: string; cols: number; rows: number }
  | { t: "paneActivate"; tabId: string }
  | { t: "modalSelect"; index: number }
  | { t: "modalConfirm"; index?: number }
  | { t: "setSplitRatio"; tabId: string; ratio: number; axis?: SplitDirection }
  | { t: "openNewTab" }
  | { t: "closeTab"; tabId: string }
  | { t: "switchSession"; sessionId: string }
  | { t: "createSession"; path: string }
  | { t: "deleteSession"; sessionId: string }
  | { t: "openWorktreeMove"; sourceWorktreeId: string }
  | { t: "toggleWorktreeMoveDelete" };

export type ToastLevel = "info" | "success" | "error";

export type GuiServerMessage =
  | { t: "state"; projection: AppStateProjection }
  | { t: "render"; tabId: string; viewport: TerminalSnapshot; modes: TerminalModeState }
  | { t: "exit"; tabId: string; code: number }
  | { t: "error"; tabId: string; message: string }
  | { t: "toast"; level: ToastLevel; message: string };

export type AssistantId = "claude" | "codex" | "opencode";

export type TabStatus = "starting" | "running" | "disconnected" | "exited" | "error";

export type TabActivity = "busy" | "idle";

export type FocusMode = "navigation" | "terminal-input" | "modal" | "command-edit";

export type ModalType = "new-tab" | "session-picker" | "session-name" | "help" | null;

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

export interface PersistedTabSnapshot {
  id: string;
  assistant: AssistantId;
  title: string;
  command: string;
  status: Exclude<TabStatus, "disconnected">;
  buffer: string;
  viewport?: TerminalSnapshot;
  terminalModes: TerminalModeState;
  errorMessage?: string;
  exitCode?: number;
}

export interface WorkspaceSnapshotV1 {
  version: 1;
  savedAt: string;
  activeTabId: string | null;
  sidebar: {
    visible: boolean;
    width: number;
  };
  tabs: PersistedTabSnapshot[];
}

export interface SessionRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  workspaceSnapshot?: WorkspaceSnapshotV1;
}

export interface TabSession {
  id: string;
  assistant: AssistantId;
  title: string;
  status: TabStatus;
  activity?: TabActivity;
  buffer: string;
  viewport?: TerminalSnapshot;
  terminalModes: TerminalModeState;
  command: string;
  errorMessage?: string;
  exitCode?: number;
}

export interface SidebarState {
  visible: boolean;
  width: number;
  minWidth: number;
  maxWidth: number;
}

export interface ModalState {
  type: ModalType;
  selectedIndex: number;
  editBuffer: string | null;
  sessionTargetId: string | null;
}

export interface LayoutState {
  terminalCols: number;
  terminalRows: number;
}

export interface AppState {
  tabs: TabSession[];
  activeTabId: string | null;
  sessions: SessionRecord[];
  currentSessionId: string | null;
  focusMode: FocusMode;
  sidebar: SidebarState;
  modal: ModalState;
  layout: LayoutState;
  customCommands: Record<AssistantId, string>;
}

export type AppAction =
  | { type: "open-new-tab-modal" }
  | { type: "open-help-modal" }
  | { type: "open-session-picker" }
  | { type: "open-session-name-modal"; sessionTargetId?: string; initialName?: string }
  | { type: "close-modal" }
  | { type: "move-modal-selection"; delta: number }
  | { type: "add-tab"; tab: TabSession }
  | { type: "hydrate-workspace"; tabs: TabSession[]; activeTabId: string | null }
  | { type: "load-session"; sessionId: string; workspaceSnapshot?: WorkspaceSnapshotV1 }
  | { type: "set-sessions"; sessions: SessionRecord[] }
  | { type: "create-session-record"; session: SessionRecord }
  | { type: "rename-session-record"; sessionId: string; name: string }
  | { type: "delete-session-record"; sessionId: string }
  | { type: "close-tab"; tabId: string }
  | { type: "close-active-tab" }
  | { type: "set-active-tab"; tabId: string }
  | { type: "move-active-tab"; delta: number }
  | { type: "reorder-active-tab"; delta: number }
  | { type: "reset-tab-session"; tabId: string }
  | { type: "toggle-sidebar" }
  | { type: "resize-sidebar"; delta: number }
  | { type: "set-focus-mode"; focusMode: FocusMode }
  | { type: "append-tab-buffer"; tabId: string; chunk: string }
  | {
      type: "replace-tab-viewport";
      tabId: string;
      viewport: TerminalSnapshot;
      terminalModes: TerminalModeState;
    }
  | { type: "set-tab-activity"; tabId: string; activity?: TabActivity }
  | { type: "set-tab-status"; tabId: string; status: TabStatus; exitCode?: number }
  | { type: "set-tab-error"; tabId: string; message: string }
  | { type: "set-terminal-size"; cols: number; rows: number }
  | { type: "begin-command-edit" }
  | { type: "update-command-edit"; char: string }
  | { type: "commit-command-edit" }
  | { type: "cancel-command-edit" };

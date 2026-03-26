export type AssistantId = "claude" | "codex" | "opencode";

export type TabStatus = "starting" | "running" | "exited" | "error";

export type TabActivity = "busy" | "idle";

export type FocusMode = "navigation" | "terminal-input" | "modal";

export type ModalType = "new-tab" | null;

export interface TerminalSpan {
  text: string;
  fg?: string;
  bg?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface TerminalLine {
  spans: TerminalSpan[];
}

export interface TerminalSnapshot {
  lines: TerminalLine[];
}

export interface TabSession {
  id: string;
  assistant: AssistantId;
  title: string;
  status: TabStatus;
  activity?: TabActivity;
  buffer: string;
  viewport?: TerminalSnapshot;
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
}

export interface LayoutState {
  terminalCols: number;
  terminalRows: number;
}

export interface AppState {
  tabs: TabSession[];
  activeTabId: string | null;
  focusMode: FocusMode;
  sidebar: SidebarState;
  modal: ModalState;
  layout: LayoutState;
}

export type AppAction =
  | { type: "open-new-tab-modal" }
  | { type: "close-modal" }
  | { type: "move-modal-selection"; delta: number }
  | { type: "add-tab"; tab: TabSession }
  | { type: "close-tab"; tabId: string }
  | { type: "close-active-tab" }
  | { type: "set-active-tab"; tabId: string }
  | { type: "move-active-tab"; delta: number }
  | { type: "reorder-active-tab"; delta: number }
  | { type: "toggle-sidebar" }
  | { type: "resize-sidebar"; delta: number }
  | { type: "set-focus-mode"; focusMode: FocusMode }
  | { type: "append-tab-buffer"; tabId: string; chunk: string }
  | { type: "replace-tab-viewport"; tabId: string; viewport: TerminalSnapshot }
  | { type: "set-tab-activity"; tabId: string; activity?: TabActivity }
  | { type: "set-tab-status"; tabId: string; status: TabStatus; exitCode?: number }
  | { type: "set-tab-error"; tabId: string; message: string }
  | { type: "set-terminal-size"; cols: number; rows: number };

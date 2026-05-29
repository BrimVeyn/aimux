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
}

export interface SessionRecordLite {
  id: string;
  name: string;
  projectPath?: string;
  worktrees?: WorktreeLite[];
}

/** Loose view of aimux's ModalState (only the fields the GUI renders so far). */
export interface ModalProjection {
  type: string | null;
  editBuffer: string | null;
  selectedIndex: number;
  selectedAssistantId?: string | null;
  step?: "assistant" | "worktree" | "worktree-create";
  createWorktree?: boolean;
  worktreeName?: string;
  branchName?: string;
}

/** The slice of aimux's AppState the GUI renders (full state is streamed). */
export interface AppStateProjection {
  tabs: ProjectedTab[];
  activeTabId: string | null;
  sessions: SessionRecordLite[];
  currentSessionId: string | null;
  sessionStatuses: Record<string, SessionStatus>;
  focusMode: FocusMode;
  modal: ModalProjection;
  customCommands: Record<string, string>;
  sidebar: { visible: boolean; width: number };
  sessionBar: { visible: boolean; position: "top" | "bottom" };
  themeId: string;
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
  | { t: "openNewTab" }
  | { t: "closeTab"; tabId: string }
  | { t: "switchSession"; sessionId: string }
  | { t: "createSession"; path: string }
  | { t: "deleteSession"; sessionId: string };

export type ToastLevel = "info" | "success" | "error";

export type GuiServerMessage =
  | { t: "state"; projection: AppStateProjection }
  | { t: "render"; tabId: string; viewport: TerminalSnapshot; modes: TerminalModeState }
  | { t: "exit"; tabId: string; code: number }
  | { t: "error"; tabId: string; message: string }
  | { t: "toast"; level: ToastLevel; message: string };

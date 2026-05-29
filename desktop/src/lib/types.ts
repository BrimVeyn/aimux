// Mirror of the host-side contract in aimux's `src/gui/protocol.ts` and the
// terminal snapshot shape in `src/state/types.ts`. Kept as a local copy so the
// Vite project stays decoupled from the backend's TS project (which pulls in
// shiki / aimux-config). Keep in sync if the host protocol changes.

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

export interface SessionStatus {
  working: boolean;
  waiting: boolean;
}

export interface TabMeta {
  id: string;
  title: string;
  command: string;
  assistant: string;
  activity?: TabActivity;
}

export interface SessionMeta {
  id: string;
  name: string;
  path?: string;
  status?: SessionStatus;
}

export type GuiClientMessage =
  | { t: "input"; data: string }
  | { t: "resize"; cols: number; rows: number }
  | { t: "scroll"; deltaLines: number }
  | { t: "setActiveTab"; tabId: string }
  | { t: "createTab"; assistant: string }
  | { t: "closeTab"; tabId: string }
  | { t: "switchSession"; sessionId: string }
  | { t: "createSession"; path: string }
  | { t: "deleteSession"; sessionId: string };

export type GuiServerMessage =
  | {
      t: "init";
      tabs: TabMeta[];
      activeTabId: string | null;
      cols: number;
      rows: number;
      sessions: SessionMeta[];
      currentSessionId: string | null;
    }
  | { t: "render"; tabId: string; viewport: TerminalSnapshot; modes: TerminalModeState }
  | { t: "exit"; tabId: string; code: number }
  | { t: "error"; tabId: string; message: string }
  | { t: "tabActivity"; tabId: string; activity: TabActivity }
  | { t: "tabs"; tabs: TabMeta[]; activeTabId: string | null }
  | { t: "sessions"; sessions: SessionMeta[]; currentSessionId: string | null };

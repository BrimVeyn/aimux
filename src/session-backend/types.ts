import type { EventEmitter } from "node:events";

import type {
  TabSession,
  TerminalModeState,
  TerminalSnapshot,
  WorkspaceSnapshotV1,
} from "../state/types";

export type SessionBackendEvents = {
  render: [tabId: string, viewport: TerminalSnapshot, terminalModes: TerminalModeState];
  exit: [tabId: string, exitCode: number];
  error: [tabId: string, message: string];
};

export interface BackendAttachResult {
  tabs: TabSession[];
  activeTabId: string | null;
}

export interface SessionBackend extends EventEmitter<SessionBackendEvents> {
  attach(options: {
    sessionId: string;
    cols: number;
    rows: number;
    workspaceSnapshot?: WorkspaceSnapshotV1;
  }): Promise<BackendAttachResult | null>;
  createSession(options: {
    tabId: string;
    assistant: TabSession["assistant"];
    title: string;
    command: string;
    args?: string[];
    cols: number;
    rows: number;
    cwd?: string;
  }): void;
  write(tabId: string, input: string): void;
  scrollViewport(tabId: string, deltaLines: number): void;
  scrollViewportToBottom(tabId: string): void;
  setActiveTab(tabId: string | null): void;
  resizeAll(cols: number, rows: number): void;
  disposeSession(tabId: string): void;
  disposeAll(): void;
  destroy(keepSessions?: boolean): Promise<void> | void;
}

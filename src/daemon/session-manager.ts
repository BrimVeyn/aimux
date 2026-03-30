import { EventEmitter } from "node:events";

import { logDebug } from "../debug/input-log";
import type { WorkspaceSnapshotV1 } from "../state/types";
import { SessionRegistry } from "./session-registry";
import type { TerminalModeState, TerminalSnapshot } from "../state/types";

type SessionManagerEvents = {
  render: [
    sessionId: string,
    tabId: string,
    viewport: TerminalSnapshot,
    terminalModes: TerminalModeState,
  ];
  exit: [sessionId: string, tabId: string, exitCode: number];
  error: [sessionId: string, tabId: string, message: string];
};

export class SessionManager extends EventEmitter<SessionManagerEvents> {
  private registries = new Map<string, SessionRegistry>();

  private getOrCreateRegistry(sessionId: string): SessionRegistry {
    const existing = this.registries.get(sessionId);
    if (existing) {
      logDebug("daemon.sessionManager.reuseRegistry", { sessionId });
      return existing;
    }

    logDebug("daemon.sessionManager.createRegistry", { sessionId });
    const registry = new SessionRegistry();
    registry.on("render", (tabId, viewport, terminalModes) => {
      this.emit("render", sessionId, tabId, viewport, terminalModes);
    });
    registry.on("exit", (tabId, exitCode) => {
      this.emit("exit", sessionId, tabId, exitCode);
    });
    registry.on("error", (tabId, message) => {
      this.emit("error", sessionId, tabId, message);
    });
    this.registries.set(sessionId, registry);
    return registry;
  }

  attachSession(sessionId: string, snapshot?: WorkspaceSnapshotV1) {
    logDebug("daemon.sessionManager.attachSession", {
      sessionId,
      hasSnapshot: !!snapshot,
      snapshotTabs: snapshot?.tabs.length ?? 0,
    });
    return this.getOrCreateRegistry(sessionId).attachFromSnapshot(snapshot);
  }

  createTab(sessionId: string, options: Parameters<SessionRegistry["createSession"]>[0]): void {
    logDebug("daemon.sessionManager.createTab", {
      sessionId,
      tabId: options.tabId,
      title: options.title,
      command: options.command,
    });
    this.getOrCreateRegistry(sessionId).createSession(options);
  }

  write(sessionId: string, tabId: string, data: string): void {
    logDebug("daemon.sessionManager.write", { sessionId, tabId, inputLength: data.length });
    this.getOrCreateRegistry(sessionId).write(tabId, data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    logDebug("daemon.sessionManager.resize", { sessionId, cols, rows });
    this.getOrCreateRegistry(sessionId).resizeAll(cols, rows);
  }

  scroll(sessionId: string, tabId: string, deltaLines: number): void {
    logDebug("daemon.sessionManager.scroll", { sessionId, tabId, deltaLines });
    this.getOrCreateRegistry(sessionId).scrollViewport(tabId, deltaLines);
  }

  scrollToBottom(sessionId: string, tabId: string): void {
    logDebug("daemon.sessionManager.scrollToBottom", { sessionId, tabId });
    this.getOrCreateRegistry(sessionId).scrollViewportToBottom(tabId);
  }

  setActiveTab(sessionId: string, tabId: string | null): void {
    logDebug("daemon.sessionManager.setActiveTab", { sessionId, tabId });
    this.getOrCreateRegistry(sessionId).setActiveTab(tabId);
  }

  closeTab(sessionId: string, tabId: string): void {
    logDebug("daemon.sessionManager.closeTab", { sessionId, tabId });
    this.getOrCreateRegistry(sessionId).closeTab(tabId);
  }

  disposeSession(sessionId: string): void {
    logDebug("daemon.sessionManager.disposeSession", {
      sessionId,
      hadRegistry: this.registries.has(sessionId),
    });
    const registry = this.registries.get(sessionId);
    if (!registry) {
      return;
    }
    registry.disposeAll();
    this.registries.delete(sessionId);
  }

  disposeAll(): void {
    logDebug("daemon.sessionManager.disposeAll", { sessionCount: this.registries.size });
    for (const registry of this.registries.values()) {
      registry.disposeAll();
    }
    this.registries.clear();
  }
}

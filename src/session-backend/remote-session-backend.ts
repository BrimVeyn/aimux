import { EventEmitter } from "node:events";
import { Socket, connect } from "node:net";

import { logDebug } from "../debug/input-log";
import { getDaemonSocketPath } from "../daemon/runtime-paths";
import {
  encodeMessage,
  MessageDecoder,
  type AttachResult,
  type ClientRequest,
  type ServerEvent,
  type ServerResponse,
} from "../ipc/protocol";
import type { WorkspaceSnapshotV1 } from "../state/types";
import type { SessionBackend, SessionBackendEvents } from "./types";

export class RemoteSessionBackend
  extends EventEmitter<SessionBackendEvents>
  implements SessionBackend
{
  private socket: Socket | null = null;
  private readonly pending = new Map<
    string,
    { resolve: (message: ServerResponse) => void; reject: (error: Error) => void }
  >();
  private decoder = new MessageDecoder<ServerResponse | ServerEvent>();
  private attached = false;
  private currentSessionId: string | null = null;

  private rejectPendingRequests(error: Error): void {
    for (const [id, pending] of this.pending.entries()) {
      this.pending.delete(id);
      pending.reject(error);
    }
  }

  private resetConnection(reason: string): void {
    const socket = this.socket;
    this.socket = null;
    this.attached = false;
    this.currentSessionId = null;
    this.decoder.reset();
    this.rejectPendingRequests(new Error(reason));

    if (!socket) {
      return;
    }

    socket.removeAllListeners();
    if (!socket.destroyed) {
      socket.end();
      socket.destroy();
    }
  }

  private getConnectedSocket(): Socket {
    if (!this.socket || this.socket.destroyed) {
      throw new Error("Remote backend socket is unavailable");
    }

    return this.socket;
  }

  private send(request: ClientRequest): Promise<ServerResponse> {
    const socket = this.getConnectedSocket();
    logDebug("backend.remote.send", { type: request.type, id: request.id });
    return new Promise((resolve, reject) => {
      this.pending.set(request.id, { resolve, reject });
      socket.write(encodeMessage(request), (error) => {
        if (error) {
          this.pending.delete(request.id);
          logDebug("backend.remote.sendError", {
            type: request.type,
            id: request.id,
            error: error.message,
          });
          reject(error);
        }
      });
    });
  }

  private handleServerEvent(message: ServerEvent): void {
    logDebug("backend.remote.event", { type: message.type });
    switch (message.type) {
      case "tabRender":
        this.emit(
          "render",
          message.payload.tabId,
          message.payload.viewport,
          message.payload.terminalModes,
        );
        break;
      case "tabExit":
        this.emit("exit", message.payload.tabId, message.payload.exitCode);
        break;
      case "tabError":
        this.emit("error", message.payload.tabId, message.payload.message);
        break;
    }
  }

  async attach(options: {
    sessionId: string;
    cols: number;
    rows: number;
    workspaceSnapshot?: WorkspaceSnapshotV1;
  }): Promise<AttachResult> {
    const socketPath = getDaemonSocketPath();
    logDebug("backend.remote.attach.start", {
      socketPath,
      sessionId: options.sessionId,
      cols: options.cols,
      rows: options.rows,
      snapshotTabs: options.workspaceSnapshot?.tabs.length ?? 0,
    });
    this.resetConnection("Connection replaced during attach");

    const socket = connect(socketPath);
    this.socket = socket;
    this.attached = false;
    this.currentSessionId = options.sessionId;

    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    logDebug("backend.remote.attach.connected", { socketPath });

    socket.on("error", (error) => {
      if (this.socket !== socket) {
        return;
      }
      logDebug("backend.remote.socketError", { error: error.message });
      this.resetConnection(`Remote backend socket error: ${error.message}`);
    });
    socket.on("close", () => {
      if (this.socket !== socket) {
        return;
      }
      logDebug("backend.remote.socketClose");
      this.resetConnection("Remote backend socket closed");
    });

    socket.on("data", (chunk) => {
      if (this.socket !== socket) {
        return;
      }
      logDebug("backend.remote.data", { byteLength: chunk.length });
      try {
        for (const message of this.decoder.push(chunk)) {
          if ("id" in message) {
            logDebug("backend.remote.response", { type: message.type, id: message.id });
            const pending = this.pending.get(message.id);
            if (pending) {
              this.pending.delete(message.id);
              pending.resolve(message);
            }
          } else {
            this.handleServerEvent(message);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logDebug("backend.remote.socketError", { error: message });
        this.resetConnection(`Remote backend parse error: ${message}`);
      }
    });

    const response = await this.send({
      id: crypto.randomUUID(),
      type: "attach",
      payload: options,
    });

    if (response.type !== "attachResult") {
      logDebug("backend.remote.attach.unexpected", { type: response.type });
      this.resetConnection(`Unexpected attach response: ${response.type}`);
      throw new Error(
        response.type === "error" ? response.payload.message : "Unexpected attach response",
      );
    }

    this.attached = true;

    logDebug("backend.remote.attach.success", {
      sessionId: options.sessionId,
      tabs: response.payload.tabs.length,
      activeTabId: response.payload.activeTabId,
    });

    return response.payload;
  }

  createSession(options: {
    tabId: string;
    assistant: "claude" | "codex" | "opencode";
    title: string;
    command: string;
    args?: string[];
    cols: number;
    rows: number;
    cwd?: string;
  }): void {
    if (!this.attached) {
      logDebug("backend.remote.skipCreateBeforeAttach", { tabId: options.tabId });
      return;
    }

    logDebug("backend.remote.createSession", {
      sessionId: this.currentSessionId,
      tabId: options.tabId,
      title: options.title,
    });
    void this.send({
      id: crypto.randomUUID(),
      type: "createTab",
      payload: options,
    });
  }

  write(tabId: string, input: string): void {
    if (!this.attached) {
      logDebug("backend.remote.skipWriteBeforeAttach", { tabId, inputLength: input.length });
      return;
    }
    logDebug("backend.remote.write", {
      sessionId: this.currentSessionId,
      tabId,
      inputLength: input.length,
    });
    void this.send({ id: crypto.randomUUID(), type: "write", payload: { tabId, data: input } });
  }

  scrollViewport(tabId: string, deltaLines: number): void {
    if (!this.attached) {
      return;
    }
    logDebug("backend.remote.scroll", { sessionId: this.currentSessionId, tabId, deltaLines });
    void this.send({ id: crypto.randomUUID(), type: "scroll", payload: { tabId, deltaLines } });
  }

  scrollViewportToBottom(tabId: string): void {
    if (!this.attached) {
      return;
    }
    logDebug("backend.remote.scrollToBottom", { sessionId: this.currentSessionId, tabId });
    void this.send({ id: crypto.randomUUID(), type: "scrollToBottom", payload: { tabId } });
  }

  setActiveTab(tabId: string | null): void {
    if (!this.attached) {
      return;
    }
    logDebug("backend.remote.setActiveTab", { sessionId: this.currentSessionId, tabId });
    void this.send({ id: crypto.randomUUID(), type: "setActiveTab", payload: { tabId } });
  }

  resizeAll(cols: number, rows: number): void {
    if (!this.attached) {
      logDebug("backend.remote.skipResizeBeforeAttach", { cols, rows });
      return;
    }
    logDebug("backend.remote.resize", { sessionId: this.currentSessionId, cols, rows });
    void this.send({ id: crypto.randomUUID(), type: "resizeClient", payload: { cols, rows } });
  }

  disposeSession(tabId: string): void {
    if (!this.attached) {
      return;
    }
    logDebug("backend.remote.disposeSession", { sessionId: this.currentSessionId, tabId });
    void this.send({ id: crypto.randomUUID(), type: "closeTab", payload: { tabId } });
  }

  disposeAll(): void {
    if (!this.attached) {
      return;
    }
    logDebug("backend.remote.disposeAll", { sessionId: this.currentSessionId });
    void this.send({ id: crypto.randomUUID(), type: "disposeAll", payload: {} });
  }

  async destroy(keepSessions = true): Promise<void> {
    logDebug("backend.remote.destroy", { keepSessions });
    if (!keepSessions) {
      this.disposeAll();
    }
    this.resetConnection("Remote backend destroyed");
  }
}

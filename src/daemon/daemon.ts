import { createServer, type Socket } from "node:net";

import { logDebug } from "../debug/input-log";
import { getDaemonSocketPath, removeDaemonSocketIfExists } from "./runtime-paths";
import { SessionManager } from "./session-manager";
import {
  encodeMessage,
  MessageDecoder,
  type ClientRequest,
  type ServerEvent,
  type ServerResponse,
} from "../ipc/protocol";

function send(socket: Socket, message: ServerResponse | ServerEvent): void {
  socket.write(encodeMessage(message));
}

export async function runDaemon(): Promise<void> {
  const socketPath = getDaemonSocketPath();
  logDebug("daemon.start", { socketPath, pid: process.pid });
  logDebug("daemon.removeStaleSocket", { socketPath });
  removeDaemonSocketIfExists();

  const sessionManager = new SessionManager();
  const sockets = new Set<Socket>();
  const attachedSessions = new Map<Socket, string>();

  sessionManager.on("render", (sessionId, tabId, viewport, terminalModes) => {
    const event: ServerEvent = { type: "tabRender", payload: { tabId, viewport, terminalModes } };
    for (const socket of sockets) {
      if (attachedSessions.get(socket) === sessionId) {
        send(socket, event);
      }
    }
  });
  sessionManager.on("exit", (sessionId, tabId, exitCode) => {
    const event: ServerEvent = { type: "tabExit", payload: { tabId, exitCode } };
    for (const socket of sockets) {
      if (attachedSessions.get(socket) === sessionId) {
        send(socket, event);
      }
    }
  });
  sessionManager.on("error", (sessionId, tabId, message) => {
    const event: ServerEvent = { type: "tabError", payload: { tabId, message } };
    for (const socket of sockets) {
      if (attachedSessions.get(socket) === sessionId) {
        send(socket, event);
      }
    }
  });

  const server = createServer((socket) => {
    logDebug("daemon.client.connected");
    sockets.add(socket);
    const decoder = new MessageDecoder<ClientRequest>();

    socket.on("data", (chunk) => {
      try {
        for (const message of decoder.push(chunk)) {
          try {
            logDebug("daemon.request", { type: message.type, id: message.id });
            switch (message.type) {
              case "attach": {
                attachedSessions.set(socket, message.payload.sessionId);
                sessionManager.resize(
                  message.payload.sessionId,
                  message.payload.cols,
                  message.payload.rows,
                );
                const attachResult = sessionManager.attachSession(
                  message.payload.sessionId,
                  message.payload.workspaceSnapshot,
                );
                send(socket, { id: message.id, type: "attachResult", payload: attachResult });
                break;
              }
              case "createTab":
                if (!attachedSessions.get(socket)) {
                  throw new Error("No session attached");
                }
                sessionManager.createTab(attachedSessions.get(socket)!, message.payload);
                send(socket, { id: message.id, type: "ok", payload: {} });
                break;
              case "write":
                if (!attachedSessions.get(socket)) {
                  throw new Error("No session attached");
                }
                sessionManager.write(
                  attachedSessions.get(socket)!,
                  message.payload.tabId,
                  message.payload.data,
                );
                send(socket, { id: message.id, type: "ok", payload: {} });
                break;
              case "resizeClient":
                if (!attachedSessions.get(socket)) {
                  throw new Error("No session attached");
                }
                sessionManager.resize(
                  attachedSessions.get(socket)!,
                  message.payload.cols,
                  message.payload.rows,
                );
                send(socket, { id: message.id, type: "ok", payload: {} });
                break;
              case "scroll":
                if (!attachedSessions.get(socket)) {
                  throw new Error("No session attached");
                }
                sessionManager.scroll(
                  attachedSessions.get(socket)!,
                  message.payload.tabId,
                  message.payload.deltaLines,
                );
                send(socket, { id: message.id, type: "ok", payload: {} });
                break;
              case "scrollToBottom":
                if (!attachedSessions.get(socket)) {
                  throw new Error("No session attached");
                }
                sessionManager.scrollToBottom(attachedSessions.get(socket)!, message.payload.tabId);
                send(socket, { id: message.id, type: "ok", payload: {} });
                break;
              case "setActiveTab":
                if (!attachedSessions.get(socket)) {
                  throw new Error("No session attached");
                }
                sessionManager.setActiveTab(attachedSessions.get(socket)!, message.payload.tabId);
                send(socket, { id: message.id, type: "ok", payload: {} });
                break;
              case "closeTab":
                if (!attachedSessions.get(socket)) {
                  throw new Error("No session attached");
                }
                sessionManager.closeTab(attachedSessions.get(socket)!, message.payload.tabId);
                send(socket, { id: message.id, type: "ok", payload: {} });
                break;
              case "disposeAll":
                if (attachedSessions.get(socket)) {
                  sessionManager.disposeSession(attachedSessions.get(socket)!);
                }
                send(socket, { id: message.id, type: "ok", payload: {} });
                break;
              case "ping":
                send(socket, { id: message.id, type: "ok", payload: {} });
                break;
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logDebug("daemon.request.error", { error: errorMessage, requestId: message.id });
            send(socket, { id: message.id, type: "error", payload: { message: errorMessage } });
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logDebug("daemon.request.error", { error: message });
        decoder.reset();
        send(socket, { id: crypto.randomUUID(), type: "error", payload: { message } });
      }
    });

    socket.on("close", () => {
      logDebug("daemon.client.close");
      sockets.delete(socket);
      attachedSessions.delete(socket);
    });
    socket.on("error", () => {
      logDebug("daemon.client.error");
      sockets.delete(socket);
      attachedSessions.delete(socket);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve());
  });
  logDebug("daemon.listening", { socketPath });

  process.on("SIGTERM", () => {
    logDebug("daemon.sigterm");
    sessionManager.disposeAll();
    server.close();
    process.exit(0);
  });

  process.on("SIGINT", () => {
    logDebug("daemon.sigint");
    sessionManager.disposeAll();
    server.close();
    process.exit(0);
  });

  await new Promise<void>(() => {
    // Keep the daemon process alive until it is terminated.
  });
}

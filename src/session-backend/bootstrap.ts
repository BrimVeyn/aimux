import { existsSync } from "node:fs";
import { connect } from "node:net";

import { getDaemonSocketPath, removeDaemonSocketIfExists } from "../daemon/runtime-paths";
import { logDebug } from "../debug/input-log";
import { LocalSessionBackend } from "./local-session-backend";
import { RemoteSessionBackend } from "./remote-session-backend";
import type { SessionBackend } from "./types";

async function spawnDaemon(): Promise<void> {
  logDebug("backend.spawnDaemon.start", {
    socketPath: getDaemonSocketPath(),
    execPath: process.execPath,
  });
  Bun.spawn([process.execPath, "run", "src/index.tsx", "daemon"], {
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
    detached: true,
  }).unref();

  const deadline = Date.now() + 2_000;
  const socketPath = getDaemonSocketPath();
  while (Date.now() < deadline) {
    if (existsSync(socketPath)) {
      logDebug("backend.spawnDaemon.ready", { socketPath });
      return;
    }
    await Bun.sleep(50);
  }

  logDebug("backend.spawnDaemon.timeout", { socketPath });
}

async function canConnectToDaemon(socketPath: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = connect(socketPath);
    const finish = (result: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.once("connect", () => finish(true));
    socket.once("error", (error: NodeJS.ErrnoException) => {
      logDebug("backend.healthcheck.error", {
        socketPath,
        code: error.code ?? "unknown",
        error: error.message,
      });
      finish(false);
    });
  });
}

export async function createSessionBackend(): Promise<SessionBackend> {
  try {
    const socketPath = getDaemonSocketPath();
    const initialReachable = await canConnectToDaemon(socketPath);
    logDebug("backend.create.start", { socketPath, initialReachable });

    if (!initialReachable) {
      removeDaemonSocketIfExists();
      await spawnDaemon();
    }

    const reachable = await canConnectToDaemon(socketPath);
    if (!reachable) {
      throw new Error(`Daemon unavailable at ${socketPath}`);
    }

    logDebug("backend.create.remote", { socketPath });
    return new RemoteSessionBackend();
  } catch (error) {
    logDebug("backend.create.localFallback", {
      error: error instanceof Error ? error.message : String(error),
    });
    return new LocalSessionBackend();
  }
}

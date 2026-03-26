import { EventEmitter } from "node:events";

import { Terminal as XTerm } from "@xterm/headless";
import { spawn, type IPty } from "bun-pty";

import type { TerminalSnapshot } from "../state/types";
import { snapshotTerminal } from "./terminal-snapshot";

type PtyManagerEvents = {
  render: [tabId: string, viewport: TerminalSnapshot];
  exit: [tabId: string, exitCode: number];
  error: [tabId: string, message: string];
};

interface SessionHandle {
  tabId: string;
  pty: IPty;
  emulator: XTerm;
  pendingWrites: number;
  pendingExitCode: number | null;
}

export class PtyManager extends EventEmitter<PtyManagerEvents> {
  private sessions = new Map<string, SessionHandle>();

  private finalizeSession(session: SessionHandle, exitCode: number): void {
    const current = this.sessions.get(session.tabId);
    if (current !== session) {
      return;
    }

    this.sessions.delete(session.tabId);
    this.emit("render", session.tabId, snapshotTerminal(session.emulator));
    session.emulator.dispose();
    this.emit("exit", session.tabId, exitCode);
  }

  createSession(options: {
    tabId: string;
    command: string;
    cols: number;
    rows: number;
    cwd?: string;
  }): void {
    this.disposeSession(options.tabId);

    try {
      const emulator = new XTerm({
        allowProposedApi: true,
        cols: options.cols,
        rows: options.rows,
        scrollback: 1000,
      });

      const pty = spawn(options.command, [], {
        name: "xterm-256color",
        cols: options.cols,
        rows: options.rows,
        cwd: options.cwd ?? process.cwd(),
        env: {
          ...process.env,
          TERM: "xterm-256color",
        },
      });

      const session: SessionHandle = {
        tabId: options.tabId,
        pty,
        emulator,
        pendingWrites: 0,
        pendingExitCode: null,
      };

      pty.onData((data) => {
        session.pendingWrites += 1;
        emulator.write(data, () => {
          session.pendingWrites -= 1;
          this.emit("render", options.tabId, snapshotTerminal(emulator));

          if (session.pendingWrites === 0 && session.pendingExitCode !== null) {
            this.finalizeSession(session, session.pendingExitCode);
          }
        });
      });

      pty.onExit(({ exitCode }) => {
        const current = this.sessions.get(options.tabId);
        if (!current || current.pty !== pty) {
          return;
        }

        if (session.pendingWrites > 0) {
          session.pendingExitCode = exitCode;
          return;
        }

        this.finalizeSession(session, exitCode);
      });

      this.sessions.set(options.tabId, session);
      this.emit("render", options.tabId, snapshotTerminal(emulator));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit("error", options.tabId, `Failed to start session: ${message}`);
    }
  }

  write(tabId: string, input: string): void {
    this.sessions.get(tabId)?.pty.write(input);
  }

  resizeAll(cols: number, rows: number): void {
    const safeCols = Math.max(20, cols);
    const safeRows = Math.max(8, rows);

    for (const session of this.sessions.values()) {
      session.pty.resize(safeCols, safeRows);
      session.emulator.resize(safeCols, safeRows);
      this.emit("render", session.tabId, snapshotTerminal(session.emulator));
    }
  }

  disposeSession(tabId: string): void {
    const session = this.sessions.get(tabId);
    if (!session) {
      return;
    }

    this.sessions.delete(tabId);
    session.pty.kill();
    session.emulator.dispose();
  }

  disposeAll(): void {
    for (const session of this.sessions.values()) {
      session.pty.kill();
      session.emulator.dispose();
    }

    this.sessions.clear();
  }
}

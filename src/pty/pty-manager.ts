import { EventEmitter } from "node:events";

import { Terminal as XTerm } from "@xterm/headless";
import { spawn, type IPty } from "bun-pty";

import type { TerminalModeState, TerminalSnapshot } from "../state/types";
import { areTerminalSnapshotsEqual, snapshotTerminal } from "./terminal-snapshot";

type PtyManagerEvents = {
  render: [tabId: string, viewport: TerminalSnapshot, terminalModes: TerminalModeState];
  exit: [tabId: string, exitCode: number];
  error: [tabId: string, message: string];
};

interface SessionHandle {
  tabId: string;
  pty: IPty;
  emulator: XTerm;
  lastSnapshot?: TerminalSnapshot;
  lastTerminalModes?: TerminalModeState;
  alternateScrollMode: boolean;
  pendingModeSequence: string;
  pendingWrites: number;
  pendingExitCode: number | null;
}

const PRIVATE_MODE_RE = /\x1b\[\?([0-9;]+)([hl])/g;

function getPendingModeSequence(sequence: string): string {
  const escapeIndex = sequence.lastIndexOf("\x1b");
  if (escapeIndex === -1) {
    return "";
  }

  const suffix = sequence.slice(escapeIndex);
  return /^\x1b(?:\[\??[0-9;]*)?$/.test(suffix) ? suffix : "";
}

function trackAlternateScrollMode(currentMode: boolean, pendingSequence: string, data: string): {
  alternateScrollMode: boolean;
  pendingSequence: string;
} {
  const sequence = `${pendingSequence}${data}`;
  let alternateScrollMode = currentMode;
  for (const match of sequence.matchAll(PRIVATE_MODE_RE)) {
    const parameters = match[1]?.split(";") ?? [];
    if (!parameters.includes("1007")) {
      continue;
    }

    alternateScrollMode = match[2] === "h";
  }

  return {
    alternateScrollMode,
    pendingSequence: getPendingModeSequence(sequence),
  };
}

function getTerminalModes(emulator: XTerm, alternateScrollMode: boolean): TerminalModeState {
  return {
    mouseTrackingMode: emulator.modes.mouseTrackingMode,
    sendFocusMode: emulator.modes.sendFocusMode,
    alternateScrollMode,
    isAlternateBuffer: emulator.buffer.active === emulator.buffer.alternate,
  };
}

export class PtyManager extends EventEmitter<PtyManagerEvents> {
  private sessions = new Map<string, SessionHandle>();

  private emitRenderIfChanged(session: SessionHandle): void {
    const nextSnapshot = snapshotTerminal(session.emulator);
    const nextTerminalModes = getTerminalModes(session.emulator, session.alternateScrollMode);
    const snapshotChanged = !areTerminalSnapshotsEqual(session.lastSnapshot, nextSnapshot);
    const modesChanged =
      !session.lastTerminalModes
      || session.lastTerminalModes.mouseTrackingMode !== nextTerminalModes.mouseTrackingMode
      || session.lastTerminalModes.sendFocusMode !== nextTerminalModes.sendFocusMode
      || session.lastTerminalModes.alternateScrollMode !== nextTerminalModes.alternateScrollMode;

    if (!snapshotChanged && !modesChanged) {
      return;
    }

    session.lastSnapshot = nextSnapshot;
    session.lastTerminalModes = nextTerminalModes;
    this.emit("render", session.tabId, nextSnapshot, nextTerminalModes);
  }

  private finalizeSession(session: SessionHandle, exitCode: number): void {
    const current = this.sessions.get(session.tabId);
    if (current !== session) {
      return;
    }

    this.sessions.delete(session.tabId);
    this.emitRenderIfChanged(session);
    session.emulator.dispose();
    this.emit("exit", session.tabId, exitCode);
  }

  createSession(options: {
    tabId: string;
    command: string;
    args?: string[];
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

      const pty = spawn(options.command, options.args ?? [], {
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
        lastSnapshot: undefined,
        lastTerminalModes: undefined,
        alternateScrollMode: false,
        pendingModeSequence: "",
        pendingWrites: 0,
        pendingExitCode: null,
      };

      pty.onData((data) => {
        const trackedModes = trackAlternateScrollMode(
          session.alternateScrollMode,
          session.pendingModeSequence,
          data,
        );
        session.alternateScrollMode = trackedModes.alternateScrollMode;
        session.pendingModeSequence = trackedModes.pendingSequence;
        session.pendingWrites += 1;
        emulator.write(data, () => {
          session.pendingWrites -= 1;
          this.emitRenderIfChanged(session);

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
      this.emitRenderIfChanged(session);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit("error", options.tabId, `Failed to start session: ${message}`);
    }
  }

  write(tabId: string, input: string): void {
    this.sessions.get(tabId)?.pty.write(input);
  }

  scrollViewport(tabId: string, deltaLines: number): void {
    const session = this.sessions.get(tabId);
    if (!session) {
      return;
    }

    session.emulator.scrollLines(deltaLines);
    this.emitRenderIfChanged(session);
  }

  scrollViewportToBottom(tabId: string): void {
    const session = this.sessions.get(tabId);
    if (!session) {
      return;
    }

    session.emulator.scrollToBottom();
    this.emitRenderIfChanged(session);
  }

  resizeAll(cols: number, rows: number): void {
    const safeCols = Math.max(20, cols);
    const safeRows = Math.max(8, rows);

    for (const session of this.sessions.values()) {
      session.pty.resize(safeCols, safeRows);
      session.emulator.resize(safeCols, safeRows);
      this.emitRenderIfChanged(session);
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

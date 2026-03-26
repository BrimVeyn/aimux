import { describe, expect, test } from "bun:test";
import { Terminal } from "@xterm/headless";

import { areTerminalSnapshotsEqual, snapshotTerminal } from "../../src/pty/terminal-snapshot";

describe("snapshotTerminal", () => {
  test("preserves ANSI foreground colors", async () => {
    const terminal = new Terminal({ allowProposedApi: true, cols: 20, rows: 4 });

    await new Promise<void>((resolve) => {
      terminal.write("\u001b[31mred\u001b[0m", resolve);
    });

    const snapshot = snapshotTerminal(terminal);
    const firstLine = snapshot.lines[0];

    expect(firstLine?.spans[0]?.text.trim()).toBe("red");
    expect(firstLine?.spans[0]?.fg).toBe("#cd0000");

    terminal.dispose();
  });

  test("renders inverse video with fallback terminal defaults", async () => {
    const terminal = new Terminal({ allowProposedApi: true, cols: 20, rows: 4 });

    await new Promise<void>((resolve) => {
      terminal.write("\u001b[7mrev\u001b[0m", resolve);
    });

    const snapshot = snapshotTerminal(terminal);
    const firstLine = snapshot.lines[0];

    expect(firstLine?.spans[0]?.text.trim()).toBe("rev");
    expect(firstLine?.spans[0]?.fg).toBe("#11151b");
    expect(firstLine?.spans[0]?.bg).toBe("#edf4ff");

    terminal.dispose();
  });

  test("compares identical snapshots as equal", async () => {
    const terminal = new Terminal({ allowProposedApi: true, cols: 20, rows: 4 });

    await new Promise<void>((resolve) => {
      terminal.write("hello", resolve);
    });

    const left = snapshotTerminal(terminal);
    const right = snapshotTerminal(terminal);

    expect(areTerminalSnapshotsEqual(left, right)).toBe(true);
    terminal.dispose();
  });

  test("detects changed text between snapshots", async () => {
    const terminal = new Terminal({ allowProposedApi: true, cols: 20, rows: 4 });

    await new Promise<void>((resolve) => {
      terminal.write("hello", resolve);
    });
    const before = snapshotTerminal(terminal);

    await new Promise<void>((resolve) => {
      terminal.write(" world", resolve);
    });
    const after = snapshotTerminal(terminal);

    expect(areTerminalSnapshotsEqual(before, after)).toBe(false);
    terminal.dispose();
  });
});

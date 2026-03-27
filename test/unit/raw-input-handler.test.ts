import { describe, expect, mock, test } from "bun:test";

import { createRawInputHandler, type TerminalContentOrigin } from "../../src/input/raw-input-handler";
import type { FocusMode } from "../../src/state/types";

const DEFAULT_ORIGIN: TerminalContentOrigin = { x: 3, y: 3, cols: 80, rows: 24 };

function createBasicMouseSequence(button: number, x: number, y: number): string {
  return `\x1b[M${String.fromCharCode(button + 32)}${String.fromCharCode(x + 32)}${String.fromCharCode(y + 32)}`;
}

function setup(overrides?: {
  focusMode?: FocusMode;
  activeTabId?: string | null;
  origin?: TerminalContentOrigin;
  mouseTrackingMode?: "none" | "x10" | "vt200" | "drag" | "any";
  alternateScrollMode?: boolean;
}) {
  const focusMode = overrides?.focusMode ?? "terminal-input";
  const activeTabId: string | null = overrides && "activeTabId" in overrides ? (overrides.activeTabId ?? null) : "tab-1";
  const origin = overrides?.origin ?? DEFAULT_ORIGIN;
  const mouseTrackingMode = overrides?.mouseTrackingMode ?? "drag";
  const alternateScrollMode = overrides?.alternateScrollMode ?? false;
  const writeToPty = mock((_tabId: string, _data: string) => {});
  const leaveTerminalInput = mock(() => {});

  const handler = createRawInputHandler({
    getFocusMode: () => focusMode,
    getActiveTabId: () => activeTabId,
    getContentOrigin: () => origin,
    getMousePassthroughEnabled: () => mouseTrackingMode !== "none" || alternateScrollMode,
    writeToPty,
    leaveTerminalInput,
  });

  return { handler, writeToPty, leaveTerminalInput };
}

describe("createRawInputHandler", () => {
  test("forwards raw keyboard sequences to PTY in terminal-input mode", () => {
    const { handler, writeToPty } = setup();
    expect(handler("\x1b[A")).toBe(true);
    expect(writeToPty).toHaveBeenCalledWith("tab-1", "\x1b[A");
  });

  test("passes through when not in terminal-input mode", () => {
    const { handler, writeToPty } = setup({ focusMode: "navigation" });
    expect(handler("\x1b[A")).toBe(false);
    expect(writeToPty).not.toHaveBeenCalled();
  });

  test("passes through when no active tab", () => {
    const { handler, writeToPty } = setup({ activeTabId: null });
    expect(handler("\x1b[A")).toBe(false);
    expect(writeToPty).not.toHaveBeenCalled();
  });

  test("intercepts raw Ctrl+Z and leaves terminal-input", () => {
    const { handler, leaveTerminalInput, writeToPty } = setup();
    expect(handler("\x1a")).toBe(true);
    expect(leaveTerminalInput).toHaveBeenCalled();
    expect(writeToPty).not.toHaveBeenCalled();
  });

  test("intercepts Kitty protocol Ctrl+Z and leaves terminal-input", () => {
    const { handler, leaveTerminalInput, writeToPty } = setup();
    expect(handler("\x1b[122;5u")).toBe(true);
    expect(leaveTerminalInput).toHaveBeenCalled();
    expect(writeToPty).not.toHaveBeenCalled();
  });

  test("forwards printable characters", () => {
    const { handler, writeToPty } = setup();
    expect(handler("a")).toBe(true);
    expect(writeToPty).toHaveBeenCalledWith("tab-1", "a");
  });

  test("normalizes Kitty Ctrl+C to ETX", () => {
    const { handler, writeToPty } = setup();
    expect(handler("\x1b[99;5u")).toBe(true);
    expect(writeToPty).toHaveBeenCalledWith("tab-1", "\x03");
  });

  test("normalizes Kitty Ctrl+L to form feed", () => {
    const { handler, writeToPty } = setup();
    expect(handler("\x1b[108;5u")).toBe(true);
    expect(writeToPty).toHaveBeenCalledWith("tab-1", "\f");
  });

  test("normalizes Kitty Ctrl+/ to unit separator", () => {
    const { handler, writeToPty } = setup();
    expect(handler("\x1b[47;5u")).toBe(true);
    expect(writeToPty).toHaveBeenCalledWith("tab-1", "\x1f");
  });

  describe("mouse coordinate adjustment", () => {
    // Origin at x=3, y=3 means PTY content starts at screen column 4, row 4 (1-based)
    test("adjusts SGR mouse press coordinates", () => {
      const { handler, writeToPty } = setup();
      // Screen click at (13, 8) → PTY (10, 5)
      expect(handler("\x1b[<0;13;8M")).toBe(true);
      expect(writeToPty).toHaveBeenCalledWith("tab-1", "\x1b[<0;10;5M");
    });

    test("adjusts SGR mouse release coordinates", () => {
      const { handler, writeToPty } = setup();
      expect(handler("\x1b[<0;13;8m")).toBe(true);
      expect(writeToPty).toHaveBeenCalledWith("tab-1", "\x1b[<0;10;5m");
    });

    test("adjusts scroll events", () => {
      const { handler, writeToPty } = setup();
      // Scroll up at screen (20, 10) → PTY (17, 7)
      expect(handler("\x1b[<64;20;10M")).toBe(true);
      expect(writeToPty).toHaveBeenCalledWith("tab-1", "\x1b[<64;17;7M");
    });

    test("adjusts legacy mouse press coordinates and normalizes to SGR", () => {
      const { handler, writeToPty } = setup();
      expect(handler(createBasicMouseSequence(0, 13, 8))).toBe(true);
      expect(writeToPty).toHaveBeenCalledWith("tab-1", "\x1b[<0;10;5M");
    });

    test("adjusts legacy wheel events and normalizes to SGR", () => {
      const { handler, writeToPty } = setup();
      expect(handler(createBasicMouseSequence(64, 20, 10))).toBe(true);
      expect(writeToPty).toHaveBeenCalledWith("tab-1", "\x1b[<64;17;7M");
    });

    test("adjusts legacy mouse release coordinates and normalizes to SGR", () => {
      const { handler, writeToPty } = setup();
      expect(handler(createBasicMouseSequence(3, 13, 8))).toBe(true);
      expect(writeToPty).toHaveBeenCalledWith("tab-1", "\x1b[<3;10;5m");
    });

    test("discards mouse events outside terminal area", () => {
      const { handler, writeToPty } = setup();
      // Click in sidebar area (screen x=2, which maps to pty_x = -1)
      expect(handler("\x1b[<0;2;5M")).toBe(true);
      expect(writeToPty).not.toHaveBeenCalled();
    });

    test("discards mouse events below terminal area", () => {
      const { handler, writeToPty } = setup();
      // Click below terminal (y > rows + origin.y)
      expect(handler("\x1b[<0;10;100M")).toBe(true);
      expect(writeToPty).not.toHaveBeenCalled();
    });

    test("accounts for sidebar in origin offset", () => {
      // Sidebar visible: sidebar.width(28) + 3 borders/gap = 31 → origin x = 1 + 31 + 1 + 1 = 34
      const origin: TerminalContentOrigin = { x: 34, y: 3, cols: 80, rows: 24 };
      const { handler, writeToPty } = setup({ origin });
      // Screen click at (35, 4) → PTY (1, 1)
      expect(handler("\x1b[<0;35;4M")).toBe(true);
      expect(writeToPty).toHaveBeenCalledWith("tab-1", "\x1b[<0;1;1M");
    });

    test("passes mouse sequences through when terminal mouse tracking is disabled", () => {
      const { handler, writeToPty } = setup({ mouseTrackingMode: "none" });
      expect(handler("\x1b[<0;13;8M")).toBe(false);
      expect(writeToPty).not.toHaveBeenCalled();
    });

    test("passes out-of-bounds mouse sequences through when terminal mouse tracking is disabled", () => {
      const { handler, writeToPty } = setup({ mouseTrackingMode: "none" });
      expect(handler("\x1b[<0;2;5M")).toBe(false);
      expect(writeToPty).not.toHaveBeenCalled();
    });

    test("discards out-of-bounds legacy mouse events", () => {
      const { handler, writeToPty } = setup();
      expect(handler(createBasicMouseSequence(0, 2, 5))).toBe(true);
      expect(writeToPty).not.toHaveBeenCalled();
    });

    test("passes legacy mouse sequences through when terminal mouse tracking is disabled", () => {
      const { handler, writeToPty } = setup({ mouseTrackingMode: "none" });
      expect(handler(createBasicMouseSequence(0, 13, 8))).toBe(false);
      expect(writeToPty).not.toHaveBeenCalled();
    });

    test("forwards mouse when alternate scroll passthrough is active", () => {
      const { handler, writeToPty } = setup({ mouseTrackingMode: "none", alternateScrollMode: true });
      expect(handler("\x1b[<64;20;10M")).toBe(true);
      expect(writeToPty).toHaveBeenCalledWith("tab-1", "\x1b[<64;17;7M");
    });
  });
});

import { describe, expect, mock, test } from "bun:test";

import { createRawInputHandler } from "../../src/input/raw-input-handler";
import type { FocusMode } from "../../src/state/types";

function setup(overrides?: {
  focusMode?: FocusMode;
  activeTabId?: string | null;
}) {
  const focusMode = overrides?.focusMode ?? "terminal-input";
  const activeTabId: string | null = overrides && "activeTabId" in overrides ? (overrides.activeTabId ?? null) : "tab-1";
  const writeToPty = mock((_tabId: string, _data: string) => {});
  const leaveTerminalInput = mock(() => {});

  const handler = createRawInputHandler({
    getFocusMode: () => focusMode,
    getActiveTabId: () => activeTabId,
    getContentOrigin: () => ({ x: 0, y: 0, cols: 80, rows: 24 }),
    getMousePassthroughEnabled: () => true,
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

  test("leaves terminal-input on Ctrl+Z even without an active tab", () => {
    const { handler, leaveTerminalInput, writeToPty } = setup({ activeTabId: null });
    expect(handler("\x1a")).toBe(true);
    expect(leaveTerminalInput).toHaveBeenCalled();
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
});

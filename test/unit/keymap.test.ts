import { describe, expect, test } from "bun:test";

import { keyEventToPtyInput, resolveKeyIntent } from "../../src/input/keymap";

describe("resolveKeyIntent", () => {
  test("maps navigation shortcuts", () => {
    expect(resolveKeyIntent({ name: "j", ctrl: false, meta: false, shift: false, sequence: "j" }, "navigation")).toEqual({
      type: "move-tab",
      delta: 1,
    });

    expect(resolveKeyIntent({ name: "w", ctrl: true, meta: false, shift: false, sequence: "\u0017" }, "navigation")).toEqual({
      type: "close-tab",
    });

    expect(resolveKeyIntent({ name: "j", ctrl: false, meta: false, shift: true, sequence: "J" }, "navigation")).toEqual({
      type: "reorder-tab",
      delta: 1,
    });

    expect(resolveKeyIntent({ name: "k", ctrl: false, meta: false, shift: true, sequence: "K" }, "navigation")).toEqual({
      type: "reorder-tab",
      delta: -1,
    });

    expect(resolveKeyIntent({ name: "i", ctrl: false, meta: false, shift: false, sequence: "i" }, "navigation")).toEqual({
      type: "enter-terminal-input",
    });
  });

  test("maps modal shortcuts", () => {
    expect(resolveKeyIntent({ name: "return", ctrl: false, meta: false, shift: false, sequence: "\r" }, "modal")).toEqual({
      type: "confirm-modal",
    });

    expect(resolveKeyIntent({ name: "escape", ctrl: false, meta: false, shift: false, sequence: "\u001b" }, "modal")).toEqual({
      type: "close-modal",
    });

    expect(resolveKeyIntent({ name: "b", ctrl: true, meta: false, shift: false, sequence: "\u0002" }, "modal")).toBeNull();
  });

  test("maps terminal unfocus shortcut", () => {
    expect(resolveKeyIntent({ name: "z", ctrl: true, meta: false, shift: false, sequence: "\u001a" }, "terminal-input")).toEqual({
      type: "leave-terminal-input",
    });
  });

  test("does not steal resize shortcuts while terminal is focused", () => {
    expect(resolveKeyIntent({ name: "l", ctrl: true, meta: false, shift: false, sequence: "\f" }, "terminal-input")).toEqual({
      type: "send-to-pty",
      data: "\f",
    });
  });

  test("does not steal close shortcut while terminal is focused", () => {
    expect(resolveKeyIntent({ name: "w", ctrl: true, meta: false, shift: false, sequence: "\u0017" }, "terminal-input")).toEqual({
      type: "send-to-pty",
      data: "\u0017",
    });
  });
});

describe("keyEventToPtyInput", () => {
  test("serializes common terminal keys", () => {
    expect(keyEventToPtyInput({ name: "return", ctrl: false, meta: false, shift: false, sequence: "\r" })).toBe("\r");
    expect(keyEventToPtyInput({ name: "up", ctrl: false, meta: false, shift: false, sequence: "" })).toBe("\u001b[A");
    expect(keyEventToPtyInput({ name: "c", ctrl: true, meta: false, shift: false, sequence: "\u0003" })).toBe("\u0003");
    expect(keyEventToPtyInput({ name: "delete", ctrl: false, meta: false, shift: false, sequence: "" })).toBe("\u001b[3~");
    expect(keyEventToPtyInput({ name: "x", ctrl: false, meta: true, shift: false, sequence: "x" })).toBe("\u001bx");
  });
});

import { describe, expect, test } from "bun:test";

import { resolveKeyIntent } from "../../src/input/keymap";

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

  test("ignores all keys in terminal-input mode (handled by raw input handler)", () => {
    expect(resolveKeyIntent({ name: "z", ctrl: true, meta: false, shift: false, sequence: "\u001a" }, "terminal-input")).toBeNull();
    expect(resolveKeyIntent({ name: "l", ctrl: true, meta: false, shift: false, sequence: "\f" }, "terminal-input")).toBeNull();
    expect(resolveKeyIntent({ name: "w", ctrl: true, meta: false, shift: false, sequence: "\u0017" }, "terminal-input")).toBeNull();
  });
});

import { afterEach, describe, expect, test } from "bun:test";

import { isInputDebugEnabled } from "../../src/debug/input-log";

const ORIGINAL_DEBUG_INPUT = process.env.AIMUX_DEBUG_INPUT;

afterEach(() => {
  if (ORIGINAL_DEBUG_INPUT === undefined) {
    delete process.env.AIMUX_DEBUG_INPUT;
    return;
  }

  process.env.AIMUX_DEBUG_INPUT = ORIGINAL_DEBUG_INPUT;
});

describe("isInputDebugEnabled", () => {
  test("is disabled by default", () => {
    delete process.env.AIMUX_DEBUG_INPUT;
    expect(isInputDebugEnabled()).toBe(false);
  });

  test("accepts common truthy values", () => {
    process.env.AIMUX_DEBUG_INPUT = "1";
    expect(isInputDebugEnabled()).toBe(true);

    process.env.AIMUX_DEBUG_INPUT = "true";
    expect(isInputDebugEnabled()).toBe(true);

    process.env.AIMUX_DEBUG_INPUT = "on";
    expect(isInputDebugEnabled()).toBe(true);
  });

  test("rejects other values", () => {
    process.env.AIMUX_DEBUG_INPUT = "0";
    expect(isInputDebugEnabled()).toBe(false);

    process.env.AIMUX_DEBUG_INPUT = "false";
    expect(isInputDebugEnabled()).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";

import { createInitialState } from "../../src/state/store";
import { getStatusBarModel } from "../../src/ui/status-bar-model";

describe("getStatusBarModel", () => {
  test("shows navigation hints when browsing tabs", () => {
    const state = createInitialState();
    const model = getStatusBarModel(state);

    expect(model.left).toContain("nav");
    expect(model.right).toContain("Ctrl+n new");
  });

  test("shows close and reorder hints when an active tab exists", () => {
    const state = createInitialState();
    const model = getStatusBarModel(state, {
      id: "tab-1",
      assistant: "claude",
      title: "Claude",
      status: "running",
      buffer: "",
      command: "claude",
    });

    expect(model.right).toContain("Ctrl+w close");
    expect(model.right).toContain("Shift+J/K reorder");
  });

  test("truncates long active tab labels in footer model", () => {
    const state = createInitialState();
    const model = getStatusBarModel(state, {
      id: "tab-1",
      assistant: "claude",
      title: "Claude session with a very long descriptive title",
      status: "running",
      buffer: "",
      command: "claude",
    });

    expect(model.left).toContain("...");
    expect(model.left.length).toBeLessThan(80);
  });

  test("shows focused terminal hints for active tab", () => {
    const state = {
      ...createInitialState(),
      focusMode: "terminal-input" as const,
    };
    const model = getStatusBarModel(state, {
      id: "tab-1",
      assistant: "claude",
      title: "Claude",
      status: "running",
      buffer: "",
      command: "claude",
    });

    expect(model.left).toContain("Claude");
    expect(model.right).toContain("Ctrl+z unfocus");
  });

  test("shows modal-specific hints", () => {
    const state = {
      ...createInitialState(),
      focusMode: "modal" as const,
    };
    const model = getStatusBarModel(state);

    expect(model.left).toContain("modal");
    expect(model.right).toContain("Enter confirm");
  });
});

import { describe, expect, test } from "bun:test";

import { appReducer, createInitialState } from "../../src/state/store";

describe("appReducer", () => {
  test("opens and closes the new tab modal", () => {
    const initial = createInitialState();
    const opened = appReducer(initial, { type: "open-new-tab-modal" });
    const closed = appReducer(opened, { type: "close-modal" });

    expect(opened.modal.type).toBe("new-tab");
    expect(opened.focusMode).toBe("modal");
    expect(closed.modal.type).toBeNull();
    expect(closed.focusMode).toBe("navigation");
  });

  test("adds a tab and makes it active", () => {
    const initial = createInitialState();
    const next = appReducer(initial, {
      type: "add-tab",
      tab: {
        id: "tab-1",
        assistant: "claude",
        title: "Claude",
        status: "starting",
        buffer: "",
        command: "claude",
      },
    });

    expect(next.tabs).toHaveLength(1);
    expect(next.activeTabId).toBe("tab-1");
    expect(next.modal.type).toBeNull();
  });

  test("moves active tab vertically", () => {
    const initial = {
      ...createInitialState(),
      tabs: [
        { id: "1", assistant: "claude" as const, title: "Claude", status: "running" as const, buffer: "", command: "claude" },
        { id: "2", assistant: "codex" as const, title: "Codex", status: "running" as const, buffer: "", command: "codex" },
      ],
      activeTabId: "1",
    };

    const next = appReducer(initial, { type: "move-active-tab", delta: 1 });
    expect(next.activeTabId).toBe("2");
  });

  test("closes the active tab and picks the next tab at same index", () => {
    const initial = {
      ...createInitialState(),
      tabs: [
        { id: "1", assistant: "claude" as const, title: "Claude", status: "running" as const, buffer: "", command: "claude" },
        { id: "2", assistant: "codex" as const, title: "Codex", status: "running" as const, buffer: "", command: "codex" },
        { id: "3", assistant: "opencode" as const, title: "OpenCode", status: "running" as const, buffer: "", command: "opencode" },
      ],
      activeTabId: "2",
    };

    const next = appReducer(initial, { type: "close-active-tab" });
    expect(next.tabs.map((tab) => tab.id)).toEqual(["1", "3"]);
    expect(next.activeTabId).toBe("3");
  });

  test("closes the last remaining tab to empty state", () => {
    const initial = {
      ...createInitialState(),
      tabs: [
        { id: "1", assistant: "claude" as const, title: "Claude", status: "running" as const, buffer: "", command: "claude" },
      ],
      activeTabId: "1",
      focusMode: "terminal-input" as const,
    };

    const next = appReducer(initial, { type: "close-active-tab" });
    expect(next.tabs).toHaveLength(0);
    expect(next.activeTabId).toBeNull();
    expect(next.focusMode).toBe("navigation");
  });

  test("reorders active tab upward without changing the active id", () => {
    const initial = {
      ...createInitialState(),
      tabs: [
        { id: "1", assistant: "claude" as const, title: "Claude", status: "running" as const, buffer: "", command: "claude" },
        { id: "2", assistant: "codex" as const, title: "Codex", status: "running" as const, buffer: "", command: "codex" },
        { id: "3", assistant: "opencode" as const, title: "OpenCode", status: "running" as const, buffer: "", command: "opencode" },
      ],
      activeTabId: "2",
    };

    const next = appReducer(initial, { type: "reorder-active-tab", delta: -1 });
    expect(next.tabs.map((tab) => tab.id)).toEqual(["2", "1", "3"]);
    expect(next.activeTabId).toBe("2");
  });

  test("does not reorder beyond boundaries", () => {
    const initial = {
      ...createInitialState(),
      tabs: [
        { id: "1", assistant: "claude" as const, title: "Claude", status: "running" as const, buffer: "", command: "claude" },
        { id: "2", assistant: "codex" as const, title: "Codex", status: "running" as const, buffer: "", command: "codex" },
      ],
      activeTabId: "1",
    };

    const next = appReducer(initial, { type: "reorder-active-tab", delta: -1 });
    expect(next.tabs.map((tab) => tab.id)).toEqual(["1", "2"]);
  });

  test("clamps sidebar resize", () => {
    const initial = createInitialState();
    const smaller = appReducer(initial, { type: "resize-sidebar", delta: -50 });
    const larger = appReducer(initial, { type: "resize-sidebar", delta: 99 });

    expect(smaller.sidebar.width).toBe(initial.sidebar.minWidth);
    expect(larger.sidebar.width).toBe(initial.sidebar.maxWidth);
  });
});

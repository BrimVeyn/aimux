import { describe, expect, test } from "bun:test";

import { appReducer, createInitialState } from "../../src/state/store";

function createTab(overrides: Partial<ReturnType<typeof createInitialState>["tabs"][number]> & {
  id: string;
  assistant: "claude" | "codex" | "opencode";
  title: string;
  status: "starting" | "running" | "exited" | "error";
  command: string;
}) {
  return {
    buffer: "",
    terminalModes: {
      mouseTrackingMode: "none" as const,
      sendFocusMode: false,
      alternateScrollMode: false,
      isAlternateBuffer: false,
    },
    ...overrides,
  };
}

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
      tab: createTab({
        id: "tab-1",
        assistant: "claude",
        title: "Claude",
        status: "starting",
        command: "claude",
      }),
    });

    expect(next.tabs).toHaveLength(1);
    expect(next.activeTabId).toBe("tab-1");
    expect(next.modal.type).toBeNull();
    expect(next.tabs[0]?.activity).toBe("idle");
  });

  test("moves active tab vertically", () => {
    const initial = {
      ...createInitialState(),
      tabs: [
        createTab({ id: "1", assistant: "claude", title: "Claude", status: "running", command: "claude" }),
        createTab({ id: "2", assistant: "codex", title: "Codex", status: "running", command: "codex" }),
      ],
      activeTabId: "1",
    };

    const next = appReducer(initial, { type: "move-active-tab", delta: 1 });
    expect(next.activeTabId).toBe("2");
  });

  test("wraps from last tab to first tab", () => {
    const initial = {
      ...createInitialState(),
      tabs: [
        createTab({ id: "1", assistant: "claude", title: "Claude", status: "running", command: "claude" }),
        createTab({ id: "2", assistant: "codex", title: "Codex", status: "running", command: "codex" }),
        createTab({ id: "3", assistant: "opencode", title: "OpenCode", status: "running", command: "opencode" }),
      ],
      activeTabId: "3",
    };

    const next = appReducer(initial, { type: "move-active-tab", delta: 1 });
    expect(next.activeTabId).toBe("1");
  });

  test("wraps from first tab to last tab", () => {
    const initial = {
      ...createInitialState(),
      tabs: [
        createTab({ id: "1", assistant: "claude", title: "Claude", status: "running", command: "claude" }),
        createTab({ id: "2", assistant: "codex", title: "Codex", status: "running", command: "codex" }),
        createTab({ id: "3", assistant: "opencode", title: "OpenCode", status: "running", command: "opencode" }),
      ],
      activeTabId: "1",
    };

    const next = appReducer(initial, { type: "move-active-tab", delta: -1 });
    expect(next.activeTabId).toBe("3");
  });

  test("does not create a new state when wrapping lands on the same tab", () => {
    const initial = {
      ...createInitialState(),
      tabs: [
        createTab({ id: "1", assistant: "claude", title: "Claude", status: "running", command: "claude" }),
      ],
      activeTabId: "1",
    };

    const next = appReducer(initial, { type: "move-active-tab", delta: 1 });
    expect(next).toBe(initial);
  });

  test("closes the active tab and picks the next tab at same index", () => {
    const initial = {
      ...createInitialState(),
      tabs: [
        createTab({ id: "1", assistant: "claude", title: "Claude", status: "running", command: "claude" }),
        createTab({ id: "2", assistant: "codex", title: "Codex", status: "running", command: "codex" }),
        createTab({ id: "3", assistant: "opencode", title: "OpenCode", status: "running", command: "opencode" }),
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
        createTab({ id: "1", assistant: "claude", title: "Claude", status: "running", command: "claude" }),
      ],
      activeTabId: "1",
      focusMode: "terminal-input" as const,
    };

    const next = appReducer(initial, { type: "close-active-tab" });
    expect(next.tabs).toHaveLength(0);
    expect(next.activeTabId).toBeNull();
    expect(next.focusMode).toBe("navigation");
  });

  test("closes a background tab without changing active tab", () => {
    const initial = {
      ...createInitialState(),
      tabs: [
        createTab({ id: "1", assistant: "claude", title: "Claude", status: "running", command: "claude" }),
        createTab({ id: "2", assistant: "codex", title: "Codex", status: "running", command: "codex" }),
      ],
      activeTabId: "1",
    };

    const next = appReducer(initial, { type: "close-tab", tabId: "2" });
    expect(next.tabs.map((tab) => tab.id)).toEqual(["1"]);
    expect(next.activeTabId).toBe("1");
  });

  test("ignores unknown tab id when closing by id", () => {
    const initial = {
      ...createInitialState(),
      tabs: [
        createTab({ id: "1", assistant: "claude", title: "Claude", status: "running", command: "claude" }),
      ],
      activeTabId: "1",
    };

    const next = appReducer(initial, { type: "close-tab", tabId: "missing" });
    expect(next).toEqual(initial);
  });

  test("updates tab activity state", () => {
    const initial = {
      ...createInitialState(),
      tabs: [
        createTab({ id: "1", assistant: "claude", title: "Claude", status: "running", command: "claude" }),
      ],
      activeTabId: "1",
    };

    const busy = appReducer(initial, { type: "set-tab-activity", tabId: "1", activity: "busy" });
    const idle = appReducer(busy, { type: "set-tab-activity", tabId: "1", activity: "idle" });

    expect(busy.tabs[0]?.activity).toBe("busy");
    expect(idle.tabs[0]?.activity).toBe("idle");
  });

  test("reorders active tab upward without changing the active id", () => {
    const initial = {
      ...createInitialState(),
      tabs: [
        createTab({ id: "1", assistant: "claude", title: "Claude", status: "running", command: "claude" }),
        createTab({ id: "2", assistant: "codex", title: "Codex", status: "running", command: "codex" }),
        createTab({ id: "3", assistant: "opencode", title: "OpenCode", status: "running", command: "opencode" }),
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
        createTab({ id: "1", assistant: "claude", title: "Claude", status: "running", command: "claude" }),
        createTab({ id: "2", assistant: "codex", title: "Codex", status: "running", command: "codex" }),
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

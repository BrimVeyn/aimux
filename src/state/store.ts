import { ASSISTANT_OPTIONS } from "../pty/command-registry";
import { restoreWorkspaceState, type WorkspaceSnapshotV1 } from "./session-persistence";
import type { AppAction, AppState, TabSession } from "./types";

const MAX_BUFFER_LENGTH = 50_000;

function clampBuffer(buffer: string): string {
  if (buffer.length <= MAX_BUFFER_LENGTH) {
    return buffer;
  }

  return buffer.slice(buffer.length - MAX_BUFFER_LENGTH);
}

function updateTab(
  tabs: TabSession[],
  tabId: string,
  updater: (tab: TabSession) => TabSession,
): TabSession[] {
  return tabs.map((tab) => (tab.id === tabId ? updater(tab) : tab));
}

function getActiveIndex(state: AppState): number {
  if (!state.activeTabId) {
    return -1;
  }

  return state.tabs.findIndex((tab) => tab.id === state.activeTabId);
}

function closeTabAtIndex(state: AppState, indexToClose: number): AppState {
  if (indexToClose < 0 || indexToClose >= state.tabs.length) {
    return state;
  }

  const closingTabId = state.tabs[indexToClose]?.id;
  const tabs = state.tabs.filter((_, index) => index !== indexToClose);
  const nextActiveTab =
    state.activeTabId === closingTabId
      ? tabs[indexToClose] ?? tabs[indexToClose - 1] ?? null
      : tabs.find((tab) => tab.id === state.activeTabId) ?? null;

  return {
    ...state,
    tabs,
    activeTabId: nextActiveTab?.id ?? null,
    focusMode: tabs.length === 0 ? "navigation" : state.focusMode,
  };
}

export function createInitialState(
  customCommands: Record<string, string> = {},
  workspaceSnapshot?: WorkspaceSnapshotV1,
): AppState {
  const baseState: AppState = {
    tabs: [],
    activeTabId: null,
    focusMode: "navigation",
    sidebar: {
      visible: true,
      width: 28,
      minWidth: 18,
      maxWidth: 42,
    },
    modal: {
      type: null,
      selectedIndex: 0,
      editBuffer: null,
    },
    layout: {
      terminalCols: 80,
      terminalRows: 24,
    },
    customCommands,
  };

  if (!workspaceSnapshot) {
    return baseState;
  }

  return {
    ...baseState,
    ...restoreWorkspaceState(baseState, workspaceSnapshot),
  };
}

export function getActiveTab(state: AppState): TabSession | undefined {
  if (!state.activeTabId) {
    return undefined;
  }

  return state.tabs.find((tab) => tab.id === state.activeTabId);
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "open-new-tab-modal":
      return {
        ...state,
        focusMode: "modal",
        modal: {
          type: "new-tab",
          selectedIndex: 0,
          editBuffer: null,
        },
      };
    case "close-modal":
      return {
        ...state,
        focusMode: "navigation",
        modal: {
          type: null,
          selectedIndex: 0,
          editBuffer: null,
        },
      };
    case "move-modal-selection": {
      if (state.modal.type !== "new-tab") {
        return state;
      }

      const optionCount = 3;
      const nextIndex =
        (state.modal.selectedIndex + action.delta + optionCount) % optionCount;

      return {
        ...state,
        modal: {
          ...state.modal,
          selectedIndex: nextIndex,
        },
      };
    }
    case "add-tab":
      return {
        ...state,
        tabs: [
          ...state.tabs,
          {
            ...action.tab,
            activity: action.tab.activity ?? "idle",
          },
        ],
        activeTabId: action.tab.id,
        focusMode: "navigation",
        modal: {
          type: null,
          selectedIndex: 0,
          editBuffer: null,
        },
      };
    case "close-tab": {
      const tabIndex = state.tabs.findIndex((tab) => tab.id === action.tabId);
      return closeTabAtIndex(state, tabIndex);
    }
    case "close-active-tab": {
      const activeIndex = getActiveIndex(state);
      return closeTabAtIndex(state, activeIndex);
    }
    case "set-active-tab":
      return {
        ...state,
        activeTabId: action.tabId,
      };
    case "move-active-tab": {
      if (state.tabs.length === 0) {
        return state;
      }

      const currentIndex = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
      const safeIndex = currentIndex === -1 ? 0 : currentIndex;
      const nextIndex =
        (safeIndex + action.delta + state.tabs.length) % state.tabs.length;
      const nextTabId = state.tabs[nextIndex]?.id;

      if (!nextTabId || nextTabId === state.activeTabId) {
        return state;
      }

      return {
        ...state,
        activeTabId: nextTabId,
      };
    }
    case "reorder-active-tab": {
      const activeIndex = getActiveIndex(state);
      if (activeIndex === -1) {
        return state;
      }

      const nextIndex = activeIndex + action.delta;
      if (nextIndex < 0 || nextIndex >= state.tabs.length) {
        return state;
      }

      const tabs = [...state.tabs];
      const current = tabs[activeIndex];
      const target = tabs[nextIndex];

      if (!current || !target) {
        return state;
      }

      tabs[activeIndex] = target;
      tabs[nextIndex] = current;

      return {
        ...state,
        tabs,
      };
    }
    case "reset-tab-session":
      return {
        ...state,
        activeTabId: action.tabId,
        focusMode: "navigation",
        tabs: updateTab(state.tabs, action.tabId, (tab) => ({
          ...tab,
          status: "starting",
          activity: "idle",
          buffer: "",
          viewport: undefined,
          errorMessage: undefined,
          exitCode: undefined,
          terminalModes: {
            mouseTrackingMode: "none",
            sendFocusMode: false,
            alternateScrollMode: false,
            isAlternateBuffer: false,
            bracketedPasteMode: false,
          },
        })),
      };
    case "toggle-sidebar":
      return {
        ...state,
        sidebar: {
          ...state.sidebar,
          visible: !state.sidebar.visible,
        },
      };
    case "resize-sidebar": {
      const width = Math.min(
        state.sidebar.maxWidth,
        Math.max(state.sidebar.minWidth, state.sidebar.width + action.delta),
      );

      return {
        ...state,
        sidebar: {
          ...state.sidebar,
          width,
        },
      };
    }
    case "set-focus-mode":
      return {
        ...state,
        focusMode: action.focusMode,
      };
    case "append-tab-buffer":
      return {
        ...state,
        tabs: updateTab(state.tabs, action.tabId, (tab) => ({
          ...tab,
          buffer: clampBuffer(`${tab.buffer}${action.chunk}`),
          status: tab.status === "starting" ? "running" : tab.status,
        })),
      };
    case "replace-tab-viewport":
      return {
        ...state,
        tabs: updateTab(state.tabs, action.tabId, (tab) => ({
          ...tab,
          viewport: action.viewport,
          terminalModes: action.terminalModes,
          status: tab.status === "starting" ? "running" : tab.status,
        })),
      };
    case "set-tab-activity":
      return {
        ...state,
        tabs: updateTab(state.tabs, action.tabId, (tab) => ({
          ...tab,
          activity: action.activity,
        })),
      };
    case "set-tab-status":
      return {
        ...state,
        tabs: updateTab(state.tabs, action.tabId, (tab) => ({
          ...tab,
          status: action.status,
          exitCode: action.exitCode,
          activity: action.status === "running" ? tab.activity : undefined,
        })),
      };
    case "set-tab-error":
      return {
        ...state,
        tabs: updateTab(state.tabs, action.tabId, (tab) => ({
          ...tab,
          status: "error",
          activity: undefined,
          errorMessage: action.message,
          buffer: clampBuffer(`${tab.buffer}${action.message}\n`),
        })),
      };
    case "set-terminal-size":
      return {
        ...state,
        layout: {
          terminalCols: action.cols,
          terminalRows: action.rows,
        },
      };
    case "begin-command-edit": {
      if (state.modal.type !== "new-tab") {
        return state;
      }
      const option = ASSISTANT_OPTIONS[state.modal.selectedIndex];
      const assistantId = option?.id;
      const currentCmd =
        (assistantId && state.customCommands[assistantId]) ?? option?.command ?? "";
      return {
        ...state,
        focusMode: "command-edit",
        modal: { ...state.modal, editBuffer: currentCmd },
      };
    }
    case "update-command-edit": {
      if (state.modal.editBuffer === null) {
        return state;
      }
      const buf =
        action.char === "\b"
          ? state.modal.editBuffer.slice(0, -1)
          : state.modal.editBuffer + action.char;
      return { ...state, modal: { ...state.modal, editBuffer: buf } };
    }
    case "commit-command-edit": {
      if (state.modal.type !== "new-tab" || state.modal.editBuffer === null) {
        return state;
      }
      const option = ASSISTANT_OPTIONS[state.modal.selectedIndex];
      const assistantId = option?.id;
      if (!assistantId) {
        return { ...state, focusMode: "modal", modal: { ...state.modal, editBuffer: null } };
      }
      const trimmed = state.modal.editBuffer.trim();
      const newCustomCommands = { ...state.customCommands };
      if (trimmed) {
        newCustomCommands[assistantId] = trimmed;
      } else {
        delete newCustomCommands[assistantId];
      }
      return {
        ...state,
        focusMode: "modal",
        customCommands: newCustomCommands,
        modal: { ...state.modal, editBuffer: null },
      };
    }
    case "cancel-command-edit":
      return {
        ...state,
        focusMode: "modal",
        modal: { ...state.modal, editBuffer: null },
      };
    default:
      return state;
  }
}

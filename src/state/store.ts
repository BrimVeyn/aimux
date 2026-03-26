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

export function createInitialState(): AppState {
  return {
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
    },
    layout: {
      terminalCols: 80,
      terminalRows: 24,
    },
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
        },
      };
    case "close-modal":
      return {
        ...state,
        focusMode: "navigation",
        modal: {
          type: null,
          selectedIndex: 0,
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
        tabs: [...state.tabs, action.tab],
        activeTabId: action.tab.id,
        focusMode: "navigation",
        modal: {
          type: null,
          selectedIndex: 0,
        },
      };
    case "close-active-tab": {
      const activeIndex = getActiveIndex(state);
      if (activeIndex === -1) {
        return state;
      }

      const tabs = state.tabs.filter((_, index) => index !== activeIndex);
      const nextActiveTab = tabs[activeIndex] ?? tabs[activeIndex - 1] ?? null;

      return {
        ...state,
        tabs,
        activeTabId: nextActiveTab?.id ?? null,
        focusMode: tabs.length === 0 ? "navigation" : state.focusMode,
      };
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

      return {
        ...state,
        activeTabId: state.tabs[nextIndex]?.id ?? state.activeTabId,
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
          status: tab.status === "starting" ? "running" : tab.status,
        })),
      };
    case "set-tab-status":
      return {
        ...state,
        tabs: updateTab(state.tabs, action.tabId, (tab) => ({
          ...tab,
          status: action.status,
          exitCode: action.exitCode,
        })),
      };
    case "set-tab-error":
      return {
        ...state,
        tabs: updateTab(state.tabs, action.tabId, (tab) => ({
          ...tab,
          status: "error",
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
    default:
      return state;
  }
}

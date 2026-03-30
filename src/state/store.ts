import { ASSISTANT_OPTIONS } from "../pty/command-registry";
import { restoreWorkspaceState } from "./session-persistence";
import type { AppAction, AppState, SessionRecord, TabSession } from "./types";

const MAX_BUFFER_LENGTH = 50_000;

function clampBuffer(buffer: string): string {
  return buffer.length <= MAX_BUFFER_LENGTH
    ? buffer
    : buffer.slice(buffer.length - MAX_BUFFER_LENGTH);
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
      ? (tabs[indexToClose] ?? tabs[indexToClose - 1] ?? null)
      : (tabs.find((tab) => tab.id === state.activeTabId) ?? null);

  return {
    ...state,
    tabs,
    activeTabId: nextActiveTab?.id ?? null,
    focusMode: tabs.length === 0 ? "navigation" : state.focusMode,
  };
}

function emptyModal() {
  return {
    type: null,
    selectedIndex: 0,
    editBuffer: null,
    sessionTargetId: null,
  } as const;
}

export function createInitialState(
  customCommands: Record<string, string> = {},
  sessions: SessionRecord[] = [],
  showSessionPicker = false,
): AppState {
  return {
    tabs: [],
    activeTabId: null,
    sessions,
    currentSessionId: null,
    focusMode: showSessionPicker ? "modal" : "navigation",
    sidebar: {
      visible: true,
      width: 28,
      minWidth: 18,
      maxWidth: 42,
    },
    modal: showSessionPicker
      ? { type: "session-picker", selectedIndex: 0, editBuffer: null, sessionTargetId: null }
      : emptyModal(),
    layout: {
      terminalCols: 80,
      terminalRows: 24,
    },
    customCommands,
  };
}

export function getActiveTab(state: AppState): TabSession | undefined {
  return state.activeTabId ? state.tabs.find((tab) => tab.id === state.activeTabId) : undefined;
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "open-new-tab-modal":
      return {
        ...state,
        focusMode: "modal",
        modal: { type: "new-tab", selectedIndex: 0, editBuffer: null, sessionTargetId: null },
      };
    case "open-help-modal":
      return {
        ...state,
        focusMode: "modal",
        modal: { type: "help", selectedIndex: 0, editBuffer: null, sessionTargetId: null },
      };
    case "open-session-picker":
      return {
        ...state,
        focusMode: "modal",
        modal: {
          type: "session-picker",
          selectedIndex: 0,
          editBuffer: null,
          sessionTargetId: null,
        },
      };
    case "open-session-name-modal":
      return {
        ...state,
        focusMode: "command-edit",
        modal: {
          type: "session-name",
          selectedIndex: 0,
          editBuffer: action.initialName ?? "",
          sessionTargetId: action.sessionTargetId ?? null,
        },
      };
    case "close-modal":
      return { ...state, focusMode: "navigation", modal: emptyModal() };
    case "move-modal-selection": {
      if (state.modal.type !== "new-tab" && state.modal.type !== "session-picker") {
        return state;
      }
      const optionCount =
        state.modal.type === "new-tab"
          ? ASSISTANT_OPTIONS.length
          : Math.max(1, state.sessions.length + 1);
      return {
        ...state,
        modal: {
          ...state.modal,
          selectedIndex: (state.modal.selectedIndex + action.delta + optionCount) % optionCount,
        },
      };
    }
    case "add-tab":
      return {
        ...state,
        tabs: [...state.tabs, { ...action.tab, activity: action.tab.activity ?? "idle" }],
        activeTabId: action.tab.id,
        focusMode: "navigation",
        modal: emptyModal(),
      };
    case "hydrate-workspace":
      return {
        ...state,
        tabs: action.tabs,
        activeTabId: action.activeTabId,
        focusMode: "navigation",
      };
    case "load-session": {
      const snapshot =
        action.workspaceSnapshot ??
        state.sessions.find((entry) => entry.id === action.sessionId)?.workspaceSnapshot;
      return {
        ...state,
        ...restoreWorkspaceState(state, snapshot),
        currentSessionId: action.sessionId,
        sessions: state.sessions.map((entry) =>
          entry.id === action.sessionId
            ? {
                ...entry,
                lastOpenedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }
            : entry,
        ),
        focusMode: "navigation",
        modal: emptyModal(),
      };
    }
    case "set-sessions":
      return { ...state, sessions: action.sessions };
    case "create-session-record":
      return {
        ...state,
        sessions: [...state.sessions, action.session],
        currentSessionId: action.session.id,
        focusMode: "navigation",
        modal: emptyModal(),
      };
    case "rename-session-record":
      return {
        ...state,
        sessions: state.sessions.map((session) =>
          session.id === action.sessionId
            ? { ...session, name: action.name, updatedAt: new Date().toISOString() }
            : session,
        ),
        focusMode: "modal",
        modal: {
          type: "session-picker",
          selectedIndex: state.modal.selectedIndex,
          editBuffer: null,
          sessionTargetId: null,
        },
      };
    case "delete-session-record": {
      const newSessions = state.sessions.filter((session) => session.id !== action.sessionId);
      const maxIndex = newSessions.length; // index of "Create new session" option
      const clampedIndex = Math.min(state.modal.selectedIndex, maxIndex);
      return {
        ...state,
        sessions: newSessions,
        currentSessionId:
          action.sessionId === state.currentSessionId ? null : state.currentSessionId,
        tabs: action.sessionId === state.currentSessionId ? [] : state.tabs,
        activeTabId: action.sessionId === state.currentSessionId ? null : state.activeTabId,
        focusMode: "modal",
        modal: {
          type: "session-picker",
          selectedIndex: clampedIndex,
          editBuffer: null,
          sessionTargetId: null,
        },
      };
    }
    case "close-tab":
      return closeTabAtIndex(
        state,
        state.tabs.findIndex((tab) => tab.id === action.tabId),
      );
    case "close-active-tab":
      return closeTabAtIndex(state, getActiveIndex(state));
    case "set-active-tab":
      return { ...state, activeTabId: action.tabId };
    case "move-active-tab": {
      if (state.tabs.length === 0) {
        return state;
      }
      const currentIndex = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
      const safeIndex = currentIndex === -1 ? 0 : currentIndex;
      const nextIndex = (safeIndex + action.delta + state.tabs.length) % state.tabs.length;
      const nextTabId = state.tabs[nextIndex]?.id;
      return !nextTabId || nextTabId === state.activeTabId
        ? state
        : { ...state, activeTabId: nextTabId };
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
      return { ...state, tabs };
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
      return { ...state, sidebar: { ...state.sidebar, visible: !state.sidebar.visible } };
    case "resize-sidebar": {
      const width = Math.min(
        state.sidebar.maxWidth,
        Math.max(state.sidebar.minWidth, state.sidebar.width + action.delta),
      );
      return { ...state, sidebar: { ...state.sidebar, width } };
    }
    case "set-focus-mode":
      return { ...state, focusMode: action.focusMode };
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
        tabs: updateTab(state.tabs, action.tabId, (tab) => ({ ...tab, activity: action.activity })),
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
      return { ...state, layout: { terminalCols: action.cols, terminalRows: action.rows } };
    case "begin-command-edit": {
      if (state.modal.type !== "new-tab" && state.modal.type !== "session-name") {
        return state;
      }
      if (state.modal.type === "session-name") {
        return { ...state, focusMode: "command-edit" };
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
      if (state.modal.editBuffer === null) {
        return state;
      }
      if (state.modal.type === "session-name") {
        return state;
      }
      if (state.modal.type !== "new-tab") {
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
      return { ...state, focusMode: "modal", modal: { ...state.modal, editBuffer: null } };
    default:
      return state;
  }
}

import type { AppState, TabSession } from "../state/types";

export interface StatusBarModel {
  left: string;
  right: string;
}

const MAX_TAB_LABEL_LENGTH = 24;

function truncateLabel(label: string): string {
  if (label.length <= MAX_TAB_LABEL_LENGTH) {
    return label;
  }

  return `${label.slice(0, MAX_TAB_LABEL_LENGTH - 3)}...`;
}

function getActiveTabLabel(tab?: TabSession): string {
  if (!tab) {
    return "no tab";
  }

  return `${truncateLabel(tab.title)} (${tab.status})`;
}

function getNavigationHint(activeTab?: TabSession): string {
  if (!activeTab) {
    return "Ctrl+g sessions | Ctrl+n new | Ctrl+b toggle | Ctrl+h/l resize | ? help";
  }

  if (activeTab.status === "disconnected") {
    return "Ctrl+r restart restored tab | Ctrl+w close | i focus";
  }

  return "Ctrl+g sessions | j/k move | Shift+J/K reorder | Ctrl+r restart | Ctrl+w close | i focus | ? help";
}

export function getStatusBarModel(state: AppState, activeTab?: TabSession): StatusBarModel {
  const sidebar = state.sidebar.visible ? `${state.sidebar.width} cols` : "hidden";
  const sessionLabel = state.currentSessionId
    ? state.sessions.find((session) => session.id === state.currentSessionId)?.name ?? "unknown"
    : "no session";

  switch (state.focusMode) {
    case "terminal-input":
      return {
        left: `input -> ${getActiveTabLabel(activeTab)} | session: ${sessionLabel} | sb: ${sidebar}`,
        right: activeTab
          ? activeTab.status === "disconnected"
            ? "Ctrl+z unfocus | Ctrl+r restart restored tab"
            : "Ctrl+z unfocus | typing goes to active tab"
          : "Ctrl+n new | no active tab to focus",
      };
    case "modal":
      return {
        left: `modal | session: ${sessionLabel} | sb: ${sidebar}`,
        right: "j/k move | Enter confirm | n/r/d actions | Esc cancel",
      };
    case "navigation":
    default:
      return {
        left: `nav | session: ${sessionLabel} | active: ${getActiveTabLabel(activeTab)} | sb: ${sidebar}`,
        right: getNavigationHint(activeTab),
      };
  }
}

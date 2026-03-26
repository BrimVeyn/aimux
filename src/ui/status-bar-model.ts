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

export function getStatusBarModel(state: AppState, activeTab?: TabSession): StatusBarModel {
  const sidebar = state.sidebar.visible ? `${state.sidebar.width} cols` : "hidden";

  switch (state.focusMode) {
    case "terminal-input":
      return {
        left: `input -> ${getActiveTabLabel(activeTab)} | sb: ${sidebar}`,
        right: activeTab
          ? "Ctrl+z unfocus | typing goes to active tab"
          : "Ctrl+n new | no active tab to focus",
      };
    case "modal":
      return {
        left: `modal: new tab | sb: ${sidebar}`,
        right: "j/k move | Enter confirm | Esc cancel",
      };
    case "navigation":
    default:
      return {
        left: `nav | active: ${getActiveTabLabel(activeTab)} | sb: ${sidebar}`,
        right: activeTab
          ? "j/k move | Shift+J/K reorder | Ctrl+w close | i focus"
          : "Ctrl+n new | Ctrl+b toggle | Ctrl+h/l resize",
      };
  }
}

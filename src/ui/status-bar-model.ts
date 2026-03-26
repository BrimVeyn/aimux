import type { AppState, TabSession } from "../state/types";

export interface StatusBarModel {
  left: string;
  right: string;
}

function getActiveTabLabel(tab?: TabSession): string {
  if (!tab) {
    return "no tab";
  }

  return `${tab.title} (${tab.status})`;
}

export function getStatusBarModel(state: AppState, activeTab?: TabSession): StatusBarModel {
  const sidebar = state.sidebar.visible ? `${state.sidebar.width} cols` : "hidden";

  switch (state.focusMode) {
    case "terminal-input":
      return {
        left: `input -> ${getActiveTabLabel(activeTab)} | sidebar: ${sidebar}`,
        right: activeTab
          ? "Ctrl+z unfocus | typing goes to active tab"
          : "Ctrl+n new | no active tab to focus",
      };
    case "modal":
      return {
        left: `modal: new tab | sidebar: ${sidebar}`,
        right: "j/k move | Enter confirm | Esc cancel",
      };
    case "navigation":
    default:
      return {
        left: `navigation | active: ${getActiveTabLabel(activeTab)} | sidebar: ${sidebar}`,
        right: activeTab
          ? "j/k move | Shift+J/K reorder | Ctrl+w close | i focus"
          : "Ctrl+n new | Ctrl+b toggle | Ctrl+h/l resize",
      };
  }
}

import type { AppState } from "../../state/types";
import { theme } from "../theme";
import { TabItem } from "./tab-item";

interface SidebarProps {
  state: AppState;
}

export function Sidebar({ state }: SidebarProps) {
  if (!state.sidebar.visible) {
    return null;
  }

  return (
    <box
      width={state.sidebar.width}
      border
      borderColor={state.focusMode === "navigation" ? theme.borderActive : theme.border}
      padding={1}
      flexDirection="column"
      backgroundColor={theme.panelMuted}
      gap={1}
    >
      <text fg={theme.accent}>aimux</text>
      <text fg={theme.textMuted}>Ctrl+n new / Ctrl+w close / Shift+J/K reorder</text>
      <box flexDirection="column" gap={1} flexGrow={1}>
        {state.tabs.length === 0 ? (
          <box paddingTop={1}>
            <text fg={theme.textMuted}>No tabs yet. Press Ctrl+n.</text>
          </box>
        ) : (
          state.tabs.map((tab) => (
            <TabItem
              key={tab.id}
              tab={tab}
              active={tab.id === state.activeTabId}
              focused={state.focusMode === "navigation"}
            />
          ))
        )}
      </box>
    </box>
  );
}

import type { TabSession } from "../../state/types";
import { theme } from "../theme";

interface TabItemProps {
  tab: TabSession;
  active: boolean;
  focused: boolean;
}

function getStatusColor(status: TabSession["status"]): string {
  switch (status) {
    case "running":
      return theme.success;
    case "error":
      return theme.danger;
    case "exited":
      return theme.warning;
    default:
      return theme.textMuted;
  }
}

function getActivityLabel(tab: TabSession): string {
  if (tab.status === "error") {
    return "error";
  }

  if (tab.activity) {
    return tab.activity;
  }

  return tab.status;
}

export function TabItem({ tab, active, focused }: TabItemProps) {
  const label = tab.assistant.toUpperCase();
  const activityLabel = getActivityLabel(tab);
  const activityColor = tab.activity === "busy" ? theme.accent : getStatusColor(tab.status);

  return (
    <box
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      border={active}
      borderColor={active ? theme.borderActive : theme.border}
      backgroundColor={active ? theme.panel : theme.panelMuted}
      flexDirection="column"
      gap={0}
    >
      <text fg={active ? theme.text : theme.textMuted}>
        {active ? (focused ? "[>]" : "[*]") : "[ ]"} {tab.title}
      </text>
      <text fg={activityColor}>
        {label} - {activityLabel}
      </text>
    </box>
  );
}

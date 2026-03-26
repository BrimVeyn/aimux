import type { AppState, TabSession } from "../../state/types";
import { theme } from "../theme";
import { getStatusBarModel } from "../status-bar-model";

interface StatusBarProps {
  state: AppState;
  activeTab?: TabSession;
}

export function StatusBar({ state, activeTab }: StatusBarProps) {
  const model = getStatusBarModel(state, activeTab);

  return (
    <box
      border
      borderColor={theme.border}
      paddingLeft={1}
      paddingRight={1}
      justifyContent="space-between"
      backgroundColor={theme.panel}
    >
      <text fg={theme.text}>{model.left}</text>
      <text fg={theme.textMuted}>{model.right}</text>
    </box>
  );
}

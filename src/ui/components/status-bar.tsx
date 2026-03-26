import type { AppState } from "../../state/types";
import { theme } from "../theme";

interface StatusBarProps {
  state: AppState;
}

export function StatusBar({ state }: StatusBarProps) {
  return (
    <box
      border
      borderColor={theme.border}
      paddingLeft={1}
      paddingRight={1}
      justifyContent="space-between"
      backgroundColor={theme.panel}
    >
      <text fg={theme.text}>
        mode: {state.focusMode} | sidebar: {state.sidebar.visible ? `${state.sidebar.width} cols` : "hidden"}
      </text>
      <text fg={theme.textMuted}>j/k move | i focus | Ctrl+z unfocus | Ctrl+h/l resize</text>
    </box>
  );
}

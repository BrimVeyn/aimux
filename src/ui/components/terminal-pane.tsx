import type { TabSession } from "../../state/types";
import { theme } from "../theme";

interface TerminalPaneProps {
  tab?: TabSession;
  focusMode: "navigation" | "terminal-input" | "modal";
}

function getTitle(tab?: TabSession): string {
  if (!tab) {
    return "No active session";
  }

  return `${tab.title} - ${tab.status}`;
}

export function TerminalPane({ tab, focusMode }: TerminalPaneProps) {
  const output = tab?.buffer ?? "";

  return (
    <box flexDirection="column" flexGrow={1} gap={1}>
      <box
        border
        borderColor={focusMode === "terminal-input" ? theme.borderActive : theme.border}
        title={getTitle(tab)}
        padding={1}
        flexDirection="column"
        flexGrow={1}
        backgroundColor={theme.background}
      >
        {!tab ? (
          <box flexGrow={1} justifyContent="center" alignItems="center">
            <text fg={theme.textMuted}>Create a tab with Ctrl+n to launch Claude, Codex, or OpenCode.</text>
          </box>
        ) : (
          <box flexGrow={1}>
            <text fg={theme.text}>{output.length > 0 ? output : "Waiting for session output..."}</text>
          </box>
        )}
      </box>
      {tab?.errorMessage ? <text fg={theme.danger}>{tab.errorMessage}</text> : null}
    </box>
  );
}

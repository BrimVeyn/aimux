import type { ReactNode } from "react";

import type { TabSession, TerminalSpan } from "../../state/types";
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

function renderSpan(span: TerminalSpan, index: number): ReactNode {
  let node: ReactNode = span.text;

  if (span.underline) {
    node = <u>{node}</u>;
  }

  if (span.italic) {
    node = <em>{node}</em>;
  }

  if (span.bold) {
    node = <strong>{node}</strong>;
  }

  return (
    <text key={`span-${index}`} fg={span.fg ?? theme.text} bg={span.bg}>
      {node}
    </text>
  );
}

function renderViewport(tab: TabSession): ReactNode {
  if (tab.viewport && tab.viewport.lines.length > 0) {
    return tab.viewport.lines.map((line, lineIndex) => (
      <box key={`line-${lineIndex}`} flexDirection="row" minHeight={1}>
        {line.spans.length > 0 ? line.spans.map((span, spanIndex) => renderSpan(span, spanIndex)) : <text> </text>}
      </box>
    ));
  }

  return <text fg={theme.text}>{tab.buffer.length > 0 ? tab.buffer : "Waiting for session output..."}</text>;
}

export function TerminalPane({ tab, focusMode }: TerminalPaneProps) {
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
          <box flexDirection="column" flexGrow={1}>
            {renderViewport(tab)}
          </box>
        )}
      </box>
      {tab?.status === "exited" && tab.exitCode !== undefined ? (
        <text fg={theme.warning}>Process exited with code {tab.exitCode}</text>
      ) : null}
      {tab?.errorMessage ? <text fg={theme.danger}>{tab.errorMessage}</text> : null}
    </box>
  );
}

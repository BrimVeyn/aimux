import type { SessionRecord } from "../../state/types";
import { theme } from "../theme";

interface SessionPickerModalProps {
  sessions: SessionRecord[];
  selectedIndex: number;
  currentSessionId: string | null;
  currentTabCount: number;
}

function formatSessionLine(
  session: SessionRecord,
  currentSessionId: string | null,
  currentTabCount: number,
): string {
  const tabCount =
    session.id === currentSessionId
      ? currentTabCount
      : (session.workspaceSnapshot?.tabs.length ?? 0);
  return `${session.name} (${tabCount} tab${tabCount === 1 ? "" : "s"})`;
}

export function SessionPickerModal({
  sessions,
  selectedIndex,
  currentSessionId,
  currentTabCount,
}: SessionPickerModalProps) {
  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
    >
      <box
        width={56}
        border
        borderColor={theme.borderActive}
        padding={1}
        backgroundColor={theme.panel}
        flexDirection="column"
        gap={1}
      >
        <text fg={theme.accent}>Sessions</text>
        <text fg={theme.textMuted}>
          Use j/k, Enter resume, n new, r rename, d delete, Esc cancel.
        </text>
        {sessions.length === 0 ? (
          <box padding={1}>
            <text fg={theme.textMuted}>
              No sessions yet. Press Enter or n to create your first session.
            </text>
          </box>
        ) : null}
        {sessions.map((session, index) => {
          const active = index === selectedIndex;
          return (
            <box
              key={session.id}
              border
              borderColor={active ? theme.borderActive : theme.border}
              backgroundColor={active ? theme.panelMuted : theme.background}
              padding={1}
              flexDirection="column"
            >
              <text fg={active ? theme.text : theme.textMuted}>
                {active ? ">" : " "} {formatSessionLine(session, currentSessionId, currentTabCount)}
              </text>
              <text fg={theme.textMuted}>
                opened {new Date(session.lastOpenedAt).toLocaleString()}
              </text>
            </box>
          );
        })}
        <box
          border
          borderColor={selectedIndex === sessions.length ? theme.borderActive : theme.border}
          backgroundColor={selectedIndex === sessions.length ? theme.panelMuted : theme.background}
          padding={1}
        >
          <text fg={selectedIndex === sessions.length ? theme.text : theme.textMuted}>
            {selectedIndex === sessions.length ? ">" : " "} Create new session
          </text>
        </box>
      </box>
    </box>
  );
}

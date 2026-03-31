import { homedir } from 'node:os'

import type { SessionRecord } from '../../state/types'

import { theme } from '../theme'

function abbreviatePath(path: string): string {
  const home = homedir()
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path
}

interface SessionPickerModalProps {
  sessions: SessionRecord[]
  selectedIndex: number
  currentSessionId: string | null
  currentTabCount: number
  filter: string | null
}

function filterSessions(sessions: SessionRecord[], filter: string | null): SessionRecord[] {
  if (!filter) return sessions
  const lower = filter.toLowerCase()
  return sessions.filter(
    (s) =>
      s.name.toLowerCase().includes(lower) ||
      (s.projectPath && s.projectPath.toLowerCase().includes(lower))
  )
}

function formatSessionLine(
  session: SessionRecord,
  currentSessionId: string | null,
  currentTabCount: number
): string {
  const tabCount =
    session.id === currentSessionId
      ? currentTabCount
      : (session.workspaceSnapshot?.tabs.length ?? 0)
  return `${session.name} (${tabCount} tab${tabCount === 1 ? '' : 's'})`
}

export function SessionPickerModal({
  sessions,
  selectedIndex,
  currentSessionId,
  currentTabCount,
  filter,
}: SessionPickerModalProps) {
  const filtered = filterSessions(sessions, filter)

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
        <text fg={theme.accentAlt}>Sessions</text>
        <text fg={theme.textMuted}>
          j/k move, Enter resume, n new, r rename, d delete, / filter, Esc cancel.
        </text>
        {filter !== null ? (
          <box
            border
            borderColor={theme.borderActive}
            backgroundColor={theme.panelMuted}
            padding={1}
          >
            <text fg={theme.text}>/{filter}_</text>
          </box>
        ) : null}
        {filtered.length === 0 && sessions.length > 0 ? (
          <box padding={1}>
            <text fg={theme.textMuted}>
              {filter
                ? 'No matching sessions.'
                : 'No sessions yet. Press Enter or n to create your first session.'}
            </text>
          </box>
        ) : null}
        {filtered.length === 0 && sessions.length === 0 ? (
          <box padding={1}>
            <text fg={theme.textMuted}>
              No sessions yet. Press Enter or n to create your first session.
            </text>
          </box>
        ) : null}
        {filtered.map((session, index) => {
          const active = index === selectedIndex
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
                {active ? '>' : ' '} {formatSessionLine(session, currentSessionId, currentTabCount)}
              </text>
              {session.projectPath ? (
                <text fg={theme.textMuted}> {abbreviatePath(session.projectPath)}</text>
              ) : null}
            </box>
          )
        })}
        <box
          border
          borderColor={selectedIndex === filtered.length ? theme.borderActive : theme.border}
          backgroundColor={selectedIndex === filtered.length ? theme.panelMuted : theme.background}
          padding={1}
        >
          <text fg={selectedIndex === filtered.length ? theme.text : theme.textMuted}>
            {selectedIndex === filtered.length ? '>' : ' '} Create new session
          </text>
        </box>
      </box>
    </box>
  )
}

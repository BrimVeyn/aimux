import type { SessionRecord } from '../../state/types'

import { filterSessions } from '../../state/selectors'
import { abbreviatePath } from '../path-format'
import { theme } from '../theme'

interface SessionPickerModalProps {
  sessions: SessionRecord[]
  selectedIndex: number
  currentSessionId: string | null
  currentTabCount: number
  filter: string | null
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

function getEmptyStateMessage(hasFilter: boolean): string {
  if (hasFilter) {
    return 'No matching sessions.'
  }

  return 'No sessions yet. Press Enter or n to create your first session.'
}

export function SessionPickerModal({
  currentSessionId,
  currentTabCount,
  filter,
  selectedIndex,
  sessions,
}: SessionPickerModalProps) {
  const filtered = filterSessions(sessions, filter)
  const hasFilter = !!filter
  const showFilteredEmptyState = filtered.length === 0 && sessions.length > 0
  const showInitialEmptyState = filtered.length === 0 && sessions.length === 0

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
        {showFilteredEmptyState ? (
          <box padding={1}>
            <text fg={theme.textMuted}>{getEmptyStateMessage(hasFilter)}</text>
          </box>
        ) : null}
        {showInitialEmptyState ? (
          <box padding={1}>
            <text fg={theme.textMuted}>{getEmptyStateMessage(false)}</text>
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

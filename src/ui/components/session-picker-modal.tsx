import type { SessionRecord } from '../../state/types'

import { filterSessions } from '../../state/selectors'
import { abbreviatePath } from '../path-format'
import { theme } from '../theme'
import { uiTokens } from '../ui-tokens'
import { ListItem } from './list-item'
import { ModalFilterBar } from './modal-filter-bar'
import { ModalShell } from './modal-shell'

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
    <ModalShell
      title="Sessions"
      help="j/k move, Enter resume, n new, r rename, d delete, / filter, Esc cancel."
      width={uiTokens.modalWidth.lg}
      footer={<ModalFilterBar filter={filter} />}
    >
      {showFilteredEmptyState ? (
        <text fg={theme.textMuted}>{getEmptyStateMessage(hasFilter)}</text>
      ) : null}
      {showInitialEmptyState ? (
        <text fg={theme.textMuted}>{getEmptyStateMessage(false)}</text>
      ) : null}
      {filtered.map((session, index) => {
        const active = index === selectedIndex
        return (
          <ListItem
            key={session.id}
            active={active}
            title={
              <text fg={active ? theme.text : theme.textMuted}>
                {formatSessionLine(session, currentSessionId, currentTabCount)}
              </text>
            }
            subtitle={
              session.projectPath ? (
                <text fg={theme.textMuted}>{abbreviatePath(session.projectPath)}</text>
              ) : undefined
            }
          />
        )
      })}
      <ListItem
        active={selectedIndex === filtered.length}
        title={
          <text fg={selectedIndex === filtered.length ? theme.text : theme.textMuted}>
            Create new session
          </text>
        }
      />
    </ModalShell>
  )
}

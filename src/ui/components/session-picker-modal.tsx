import type { SessionRecord } from '../../state/types'

import { filterSessions } from '../../state/selectors'
import { abbreviatePath } from '../path-format'
import { orderSessionsForDisplay } from '../session-ordering'
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
  currentTabCount: number,
  displayIndex: number
): string {
  const tabCount =
    session.id === currentSessionId
      ? currentTabCount
      : (session.workspaceSnapshot?.tabs.length ?? 0)
  return `[${displayIndex}] ${session.name} (${tabCount} tab${tabCount === 1 ? '' : 's'})`
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
  const ordered = orderSessionsForDisplay(sessions)
  const baselineOrder = ordered.map((s) => s.id)
  const filtered = filterSessions(ordered, filter)
  const hasFilter = !!filter
  const showFilteredEmptyState = filtered.length === 0 && sessions.length > 0
  const showInitialEmptyState = filtered.length === 0 && sessions.length === 0

  return (
    <ModalShell
      title="Sessions"
      keybindsModeId="modal.session-picker"
      width={uiTokens.modalWidth.lg}
      footer={<ModalFilterBar filter={filter} />}
    >
      {showFilteredEmptyState ? (
        <text fg={theme.colors['descriptionForeground']}>{getEmptyStateMessage(hasFilter)}</text>
      ) : null}
      {showInitialEmptyState ? (
        <text fg={theme.colors['descriptionForeground']}>{getEmptyStateMessage(false)}</text>
      ) : null}
      {filtered.map((session, index) => {
        const active = index === selectedIndex
        const displayIndex = baselineOrder.indexOf(session.id) + 1
        return (
          <ListItem
            key={session.id}
            active={active}
            title={
              <text
                fg={
                  active ? theme.colors['editor.foreground'] : theme.colors['descriptionForeground']
                }
              >
                {formatSessionLine(session, currentSessionId, currentTabCount, displayIndex)}
              </text>
            }
            subtitle={
              session.projectPath ? (
                <text fg={theme.colors['descriptionForeground']}>
                  {abbreviatePath(session.projectPath)}
                </text>
              ) : undefined
            }
          />
        )
      })}
      <ListItem
        active={selectedIndex === filtered.length}
        title={
          <text
            fg={
              selectedIndex === filtered.length
                ? theme.colors['editor.foreground']
                : theme.colors['descriptionForeground']
            }
          >
            Create new session
          </text>
        }
      />
    </ModalShell>
  )
}

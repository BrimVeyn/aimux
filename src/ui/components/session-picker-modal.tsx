import type { SessionRecord } from '../../state/types'

import { dispatchGlobal, runSideEffectGlobal } from '../../state/dispatch-ref'
import { filterSessions } from '../../state/selectors'
import { abbreviatePath } from '../path-format'
import { orderSessionsForDisplay } from '../session-ordering'
import { useTokens } from '../theme'
import { uiTokens } from '../ui-tokens'
import { Picker, type PickerItem } from './picker'

interface SessionPickerModalProps {
  sessions: SessionRecord[]
  selectedIndex: number
  currentSessionId: string | null
  currentTabCount: number
  filter: string | null
  cursorPos?: number
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
  if (hasFilter) return 'No matching sessions.'
  return 'No sessions yet. Press Enter or n to create your first session.'
}

export function SessionPickerModal({
  currentSessionId,
  currentTabCount,
  cursorPos,
  filter,
  selectedIndex,
  sessions,
}: SessionPickerModalProps) {
  const t = useTokens()
  const ordered = orderSessionsForDisplay(sessions)
  const baselineOrder = ordered.map((s) => s.id)
  const filtered = filterSessions(ordered, filter)
  const hasFilter = !!filter

  const sessionItems: PickerItem[] = filtered.map((session, index) => {
    const active = index === selectedIndex
    const displayIndex = baselineOrder.indexOf(session.id) + 1
    return {
      key: session.id,
      onClick: () => runSideEffectGlobal({ type: 'confirm-selected-session' }),
      onDelete: () => runSideEffectGlobal({ type: 'delete-selected-session' }),
      subtitle: session.projectPath ? (
        <text fg={t.muted}>{abbreviatePath(session.projectPath)}</text>
      ) : undefined,
      title: (
        <text fg={active ? t.palette.ink : t.muted}>
          {formatSessionLine(session, currentSessionId, currentTabCount, displayIndex)}
        </text>
      ),
    }
  })

  const createNewItem: PickerItem = {
    key: '__create-new__',
    onClick: () => runSideEffectGlobal({ type: 'confirm-selected-session' }),
    title: (
      <text fg={selectedIndex === filtered.length ? t.palette.ink : t.muted}>
        Create new session
      </text>
    ),
  }

  const items = [...sessionItems, createNewItem]

  return (
    <Picker
      title="Sessions"
      keybindsModeId="modal.session-picker.filtering"
      width={uiTokens.modalWidth.lg}
      gap={1}
      filter={filter}
      cursorPos={cursorPos}
      items={items}
      selectedIndex={selectedIndex}
      emptyState={
        filtered.length === 0 ? (
          <text fg={t.muted}>{getEmptyStateMessage(hasFilter)}</text>
        ) : undefined
      }
      onHover={(index) => dispatchGlobal({ index, type: 'set-modal-selection-index' })}
    />
  )
}

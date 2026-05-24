import { useCallback, useMemo } from 'react'

import type { SessionRecord } from '../../../../state/types'

import { dispatchGlobal, runSideEffectGlobal } from '../../../../state/dispatch-ref'
import { filterSessions } from '../../../../state/selectors'
import { abbreviatePath } from '../../../path-format'
import { orderSessionsForDisplay } from '../../../session-ordering'
import { useTheme } from '../../../theme'
import { uiTokens } from '../../../ui-tokens'
import { Picker, type PickerItem } from '../shared/picker'

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
  if (hasFilter) return 'No matching workspaces.'
  return 'No workspaces yet. Press Enter or n to create your first workspace.'
}

export function SessionPickerModal({
  currentSessionId,
  currentTabCount,
  cursorPos,
  filter,
  selectedIndex,
  sessions,
}: SessionPickerModalProps) {
  const t = useTheme()
  const ordered = useMemo(() => orderSessionsForDisplay(sessions), [sessions])
  const filtered = useMemo(() => filterSessions(ordered, filter), [filter, ordered])
  const hasFilter = !!(filter != null && filter !== '')

  const items = useMemo<PickerItem[]>(() => {
    const baselineOrder = ordered.map((s) => s.id)
    const sessionItems: PickerItem[] = filtered.map((session, index) => {
      const active = index === selectedIndex
      const displayIndex = baselineOrder.indexOf(session.id) + 1
      return {
        key: session.id,
        onClick: () => runSideEffectGlobal({ type: 'confirm-selected-session' }),
        onDelete: () => runSideEffectGlobal({ type: 'delete-selected-session' }),
        subtitle:
          session.projectPath != null && session.projectPath !== '' ? (
            <text fg={t.textMuted}>{abbreviatePath(session.projectPath)}</text>
          ) : undefined,
        title: (
          <text fg={active ? t.text : t.textMuted}>
            {formatSessionLine(session, currentSessionId, currentTabCount, displayIndex)}
          </text>
        ),
      }
    })
    const createNewItem: PickerItem = {
      key: '__create-new__',
      onClick: () => runSideEffectGlobal({ type: 'confirm-selected-session' }),
      title: (
        <text fg={selectedIndex === filtered.length ? t.text : t.textMuted}>
          Create new workspace
        </text>
      ),
    }
    return [...sessionItems, createNewItem]
  }, [currentSessionId, currentTabCount, filtered, ordered, selectedIndex, t])

  const handleHover = useCallback(
    (index: number) => dispatchGlobal({ index, type: 'set-modal-selection-index' }),
    []
  )

  return (
    <Picker
      title="Workspaces"
      keybindsModeId="modal.session-picker.filtering"
      width={uiTokens.modalWidth.lg}
      gap={1}
      filter={filter}
      cursorPos={cursorPos}
      items={items}
      selectedIndex={selectedIndex}
      emptyState={
        filtered.length === 0 ? (
          <text fg={t.textMuted}>{getEmptyStateMessage(hasFilter)}</text>
        ) : undefined
      }
      onHover={handleHover}
    />
  )
}

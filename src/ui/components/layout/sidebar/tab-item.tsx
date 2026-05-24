import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { useCallback, useMemo, useState } from 'react'

import type { TabSession } from '../../../../state/types'

import { dispatchGlobal, runSideEffectGlobal } from '../../../../state/dispatch-ref'
import { useBusySpinner } from '../../../hooks/use-busy-spinner'
import { getCurrentTheme, useTheme } from '../../../theme'
import { ContextMenuBox } from '../../overlays/context-menu/context-menu-box'

interface TabItemProps {
  id?: string
  tab: TabSession
  active: boolean
  focused: boolean
  inLayout?: boolean
  /** When set, this tab's worktree can be moved — adds a "Move worktree" entry. */
  moveWorktreeId?: string
}

function getStatusColor(status: TabSession['status']): string {
  const t = getCurrentTheme()
  switch (status) {
    case 'running':
      return t.success
    case 'disconnected':
      return t.warning
    case 'error':
      return t.error
    default:
      return t.textMuted
  }
}

function getIndicator(active: boolean, focused: boolean, inLayout: boolean): string {
  if (active) {
    return focused ? '›' : '•'
  }

  return inLayout ? '·' : ' '
}

function getIndicatorColor(active: boolean, focused: boolean, inLayout: boolean): string {
  const t = getCurrentTheme()
  if (active) {
    return focused ? t.primary : t.text
  }

  return inLayout ? t.textMuted : t.textMuted
}

function BusyIndicator() {
  const t = useTheme()
  const frame = useBusySpinner()
  return (
    <text fg={t.primary} selectable={false}>
      {frame} working
    </text>
  )
}

function WaitingIndicator() {
  const t = useTheme()
  return (
    <text fg={t.warning} selectable={false}>
      ? waiting
    </text>
  )
}

function ActivityIndicator({ tab }: { tab: TabSession }) {
  const t = useTheme()
  if (tab.status === 'error') {
    return (
      <text fg={t.error} selectable={false}>
        ✗ error
      </text>
    )
  }

  if (tab.status === 'disconnected') {
    return (
      <text fg={t.warning} selectable={false}>
        ⏸ restore
      </text>
    )
  }

  if (tab.activity === 'working') {
    return <BusyIndicator />
  }

  if (tab.activity === 'waiting-input') {
    return <WaitingIndicator />
  }

  if (tab.activity === 'idle') {
    return (
      <text fg={t.success} selectable={false}>
        ● idle
      </text>
    )
  }

  return (
    <text fg={getStatusColor(tab.status)} selectable={false}>
      {tab.status}
    </text>
  )
}

export function TabItem({ active, focused, id, inLayout, moveWorktreeId, tab }: TabItemProps) {
  const t = useTheme()
  const label = tab.command.split(' ')[0]
  const isInLayout = inLayout ?? false
  const indicator = getIndicator(active, focused, isInLayout)
  const indicatorColor = getIndicatorColor(active, focused, isInLayout)
  const [hovered, setHovered] = useState(false)

  const rightClickMenu = useMemo<[string, () => void][]>(
    () => [
      [
        'Rename',
        () => {
          dispatchGlobal({ tabId: tab.id, type: 'set-active-tab' })
          dispatchGlobal({ type: 'open-rename-tab-modal' })
        },
      ],
      [
        'Close',
        () => {
          dispatchGlobal({ tabId: tab.id, type: 'close-tab' })
          runSideEffectGlobal({ tabId: tab.id, type: 'close-tab' })
        },
      ],
      [
        'Move up',
        () => {
          dispatchGlobal({ tabId: tab.id, type: 'set-active-tab' })
          dispatchGlobal({ delta: -1, type: 'reorder-active-tab' })
        },
      ],
      [
        'Move down',
        () => {
          dispatchGlobal({ tabId: tab.id, type: 'set-active-tab' })
          dispatchGlobal({ delta: 1, type: 'reorder-active-tab' })
        },
      ],
      // Move this tab's worktree into another one. Opened from here it overlays
      // the normal view (no git mode) since the open action doesn't touch focus.
      ...(moveWorktreeId != null && moveWorktreeId !== ''
        ? [
            [
              'Move worktree',
              () =>
                dispatchGlobal({
                  sourceWorktreeId: moveWorktreeId,
                  type: 'open-worktree-move-modal',
                }),
            ] as [string, () => void],
          ]
        : []),
    ],
    [moveWorktreeId, tab.id]
  )
  const handleMouseOver = useCallback(() => setHovered(true), [])
  const handleMouseOut = useCallback(() => setHovered(false), [])
  const handleCloseMouseDown = useCallback(
    (event: OtuiMouseEvent) => {
      event.stopPropagation()
      dispatchGlobal({ tabId: tab.id, type: 'close-tab' })
      runSideEffectGlobal({ tabId: tab.id, type: 'close-tab' })
    },
    [tab.id]
  )

  return (
    <ContextMenuBox
      id={id}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={0}
      paddingBottom={0}
      flexDirection="column"
      gap={0}
      rightClickMenu={rightClickMenu}
      onMouseOver={handleMouseOver}
      onMouseOut={handleMouseOut}
    >
      <box flexDirection="row" alignItems="center">
        <text fg={indicatorColor} selectable={false}>
          {indicator}{' '}
        </text>
        <box flexGrow={1}>
          <text fg={active ? t.text : t.textMuted} selectable={false}>
            {tab.title}
          </text>
        </box>
        {hovered ? (
          <box onMouseDown={handleCloseMouseDown}>
            <text fg={t.textMuted} selectable={false}>
              ×
            </text>
          </box>
        ) : null}
      </box>
      <box flexDirection="row">
        <text fg={t.textMuted} selectable={false}>
          {' '}
          {label}{' '}
        </text>
        <ActivityIndicator tab={tab} />
      </box>
    </ContextMenuBox>
  )
}

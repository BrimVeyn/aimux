import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { useCallback, useMemo, useState } from 'react'

import type { TabSession } from '../../../../state/types'

import { dispatchGlobal, runSideEffectGlobal } from '../../../../state/dispatch-ref'
import { useBusySpinner } from '../../../hooks/use-busy-spinner'
import { getCurrentTheme, useTheme } from '../../../theme'
import { FlashLabelBadge } from '../../flash/flash-label-badge'
import { ContextMenuBox } from '../../overlays/context-menu/context-menu-box'

interface TabItemProps {
  id?: string
  tab: TabSession
  active: boolean
  focused: boolean
  inLayout?: boolean
  /** When set, this tab's workspace can be moved — adds a "Move workspace" entry. */
  moveWorkspaceId?: string
  /** 1-based position in the visible tab list — rendered as `[N]` and matches Leader+N. */
  indexLabel?: string
  /** Render the close × unconditionally instead of only on hover. */
  alwaysShowClose?: boolean
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

function BusyGlyph() {
  const t = useTheme()
  const frame = useBusySpinner()
  return (
    <text fg={t.primary} selectable={false}>
      {' '}
      {frame}
    </text>
  )
}

function WaitingGlyph() {
  const t = useTheme()
  return (
    <text fg={t.warning} selectable={false}>
      {' '}
      ?
    </text>
  )
}

function ActivityGlyph({ tab }: { tab: TabSession }) {
  const t = useTheme()
  if (tab.status === 'error') {
    return (
      <text fg={t.error} selectable={false}>
        {' '}
        ✗
      </text>
    )
  }

  if (tab.status === 'disconnected') {
    return (
      <text fg={t.warning} selectable={false}>
        {' '}
        ⏸
      </text>
    )
  }

  if (tab.activity === 'working') {
    return <BusyGlyph />
  }

  if (tab.activity === 'waiting-input') {
    return <WaitingGlyph />
  }

  // The tab that rang. Louder than the plain idle dot below on purpose: that
  // one only says the session is alive, this one says something happened here
  // and you haven't read it. Opening the tab clears it.
  if (tab.unseen === true) {
    return (
      <text fg={t.warning} selectable={false}>
        {' '}
        ✓
      </text>
    )
  }

  if (tab.activity === 'idle') {
    return (
      <text fg={t.success} selectable={false}>
        {' '}
        ●
      </text>
    )
  }

  return (
    <text fg={getStatusColor(tab.status)} selectable={false}>
      {' '}
      ·
    </text>
  )
}

export function TabItem({
  active,
  alwaysShowClose,
  focused,
  id,
  indexLabel,
  inLayout,
  moveWorkspaceId,
  tab,
}: TabItemProps) {
  const t = useTheme()
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
        'Move left',
        () => {
          dispatchGlobal({ tabId: tab.id, type: 'set-active-tab' })
          dispatchGlobal({ delta: -1, type: 'reorder-active-tab' })
        },
      ],
      [
        'Move right',
        () => {
          dispatchGlobal({ tabId: tab.id, type: 'set-active-tab' })
          dispatchGlobal({ delta: 1, type: 'reorder-active-tab' })
        },
      ],
      ...(moveWorkspaceId != null && moveWorkspaceId !== ''
        ? [
            [
              'Move workspace',
              () => {
                dispatchGlobal({
                  sourceWorkspaceId: moveWorkspaceId,
                  type: 'open-workspace-move-modal',
                })
                runSideEffectGlobal({ type: 'load-workspace-move-stats' })
              },
            ] as [string, () => void],
          ]
        : []),
    ],
    [moveWorkspaceId, tab.id]
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
      flexDirection="row"
      alignItems="center"
      rightClickMenu={rightClickMenu}
      onMouseOver={handleMouseOver}
      onMouseOut={handleMouseOut}
    >
      <text fg={indicatorColor} selectable={false}>
        {indicator}{' '}
      </text>
      {indexLabel != null && indexLabel !== '' ? (
        <text fg={t.textMuted} selectable={false} wrapMode="none">
          {indexLabel}{' '}
        </text>
      ) : null}
      <FlashLabelBadge rowKey={`tab:${tab.id}`} />
      <text fg={active ? t.text : t.textMuted} selectable={false} wrapMode="none">
        {tab.title}
      </text>
      <ActivityGlyph tab={tab} />
      {alwaysShowClose === true || hovered ? (
        <box paddingLeft={1} onMouseDown={handleCloseMouseDown}>
          <text fg={t.textMuted} selectable={false}>
            ×
          </text>
        </box>
      ) : null}
    </ContextMenuBox>
  )
}

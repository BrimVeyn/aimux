import { useState } from 'react'

import type { TabSession } from '../../../../state/types'

import { dispatchGlobal, runSideEffectGlobal } from '../../../../state/dispatch-ref'
import { useBusySpinner } from '../../../hooks/use-busy-spinner'
import { getCurrentPalette, getCurrentResolved, usePalette, useTheme } from '../../../theme'
import { ContextMenuBox } from '../../overlays/context-menu/context-menu-box'

interface TabItemProps {
  id?: string
  tab: TabSession
  active: boolean
  focused: boolean
  inLayout?: boolean
}

function getStatusColor(status: TabSession['status']): string {
  const p = getCurrentPalette()
  switch (status) {
    case 'running':
      return p.success
    case 'disconnected':
      return p.warning
    case 'error':
      return p.error
    default:
      return getCurrentResolved()['text-weak']
  }
}

function getIndicator(active: boolean, focused: boolean, inLayout: boolean): string {
  if (active) {
    return focused ? '›' : '•'
  }

  return inLayout ? '·' : ' '
}

function getIndicatorColor(active: boolean, focused: boolean, inLayout: boolean): string {
  const t = getCurrentResolved()
  const p = getCurrentPalette()
  if (active) {
    return focused ? p.primary : t['text-strong']
  }

  return inLayout ? t['text-weak'] : t['text-weaker']
}

function BusyIndicator() {
  const p = usePalette()
  const frame = useBusySpinner()
  return <text fg={p.primary}>{frame} working</text>
}

function WaitingIndicator() {
  const p = usePalette()
  return <text fg={p.warning}>? waiting</text>
}

function ActivityIndicator({ tab }: { tab: TabSession }) {
  const p = usePalette()
  if (tab.status === 'error') {
    return <text fg={p.error}>✗ error</text>
  }

  if (tab.status === 'disconnected') {
    return <text fg={p.warning}>⏸ restore</text>
  }

  if (tab.activity === 'working') {
    return <BusyIndicator />
  }

  if (tab.activity === 'waiting-input') {
    return <WaitingIndicator />
  }

  if (tab.activity === 'idle') {
    return <text fg={p.success}>● idle</text>
  }

  return <text fg={getStatusColor(tab.status)}>{tab.status}</text>
}

export function TabItem({ active, focused, id, inLayout, tab }: TabItemProps) {
  const t = useTheme()
  const label = tab.command.split(' ')[0]
  const isInLayout = inLayout ?? false
  const indicator = getIndicator(active, focused, isInLayout)
  const indicatorColor = getIndicatorColor(active, focused, isInLayout)
  const [hovered, setHovered] = useState(false)

  return (
    <ContextMenuBox
      id={id}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={0}
      paddingBottom={0}
      flexDirection="column"
      gap={0}
      rightClickMenu={[
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
      ]}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
    >
      <box flexDirection="row" alignItems="center">
        <text fg={indicatorColor}>{indicator} </text>
        <box flexGrow={1}>
          <text fg={active ? t['text-base'] : t['text-weak']}>{tab.title}</text>
        </box>
        {hovered ? (
          <box
            onMouseDown={(event) => {
              event.stopPropagation()
              dispatchGlobal({ tabId: tab.id, type: 'close-tab' })
              runSideEffectGlobal({ tabId: tab.id, type: 'close-tab' })
            }}
          >
            <text fg={t['text-weak']}>×</text>
          </box>
        ) : null}
      </box>
      <box flexDirection="row">
        <text fg={t['text-weak']}> {label} </text>
        <ActivityIndicator tab={tab} />
      </box>
    </ContextMenuBox>
  )
}

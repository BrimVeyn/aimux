import { useState } from 'react'

import type { TabSession } from '../../state/types'

import { dispatchGlobal, runSideEffectGlobal } from '../../state/dispatch-ref'
import { useBusySpinner } from '../hooks/use-busy-spinner'
import { getCurrentTheme, useTheme } from '../theme'

interface TabItemProps {
  id?: string
  tab: TabSession
  active: boolean
  focused: boolean
  inLayout?: boolean
}

function getStatusColor(status: TabSession['status']): string {
  switch (status) {
    case 'running':
      return getCurrentTheme().colors['gitDecoration.addedResourceForeground']
    case 'disconnected':
      return getCurrentTheme().colors['editorWarning.foreground']
    case 'error':
      return getCurrentTheme().colors['editorError.foreground']
    default:
      return getCurrentTheme().colors['descriptionForeground']
  }
}

function getIndicator(active: boolean, focused: boolean, inLayout: boolean): string {
  if (active) {
    return focused ? '›' : '•'
  }

  return inLayout ? '·' : ' '
}

function getIndicatorColor(active: boolean, focused: boolean, inLayout: boolean): string {
  if (active) {
    return focused
      ? getCurrentTheme().colors['textLink.foreground']
      : getCurrentTheme().colors['terminal.ansiMagenta']
  }

  return inLayout
    ? getCurrentTheme().colors['descriptionForeground']
    : getCurrentTheme().colors['editor.lineHighlightBackground']
}

function BusyIndicator() {
  const theme = useTheme()
  const frame = useBusySpinner()
  return <text fg={theme.colors['textLink.foreground']}>{frame} working</text>
}

function WaitingIndicator() {
  const theme = useTheme()
  return <text fg={theme.colors['editorWarning.foreground']}>? waiting</text>
}

function ActivityIndicator({ tab }: { tab: TabSession }) {
  const theme = useTheme()
  if (tab.status === 'error') {
    return <text fg={theme.colors['editorError.foreground']}>✗ error</text>
  }

  if (tab.status === 'disconnected') {
    return <text fg={theme.colors['editorWarning.foreground']}>⏸ restore</text>
  }

  if (tab.activity === 'working') {
    return <BusyIndicator />
  }

  if (tab.activity === 'waiting-input') {
    return <WaitingIndicator />
  }

  if (tab.activity === 'idle') {
    return <text fg={theme.colors['gitDecoration.addedResourceForeground']}>● idle</text>
  }

  return <text fg={getStatusColor(tab.status)}>{tab.status}</text>
}

export function TabItem({ active, focused, id, inLayout, tab }: TabItemProps) {
  const theme = useTheme()
  const label = tab.command.split(' ')[0]
  const isInLayout = inLayout ?? false
  const indicator = getIndicator(active, focused, isInLayout)
  const indicatorColor = getIndicatorColor(active, focused, isInLayout)
  const [hovered, setHovered] = useState(false)

  return (
    <box
      id={id}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={0}
      paddingBottom={0}
      flexDirection="column"
      gap={0}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
    >
      <box flexDirection="row" alignItems="center">
        <text fg={indicatorColor}>{indicator} </text>
        <box flexGrow={1}>
          <text
            fg={active ? theme.colors['editor.foreground'] : theme.colors['descriptionForeground']}
          >
            {tab.title}
          </text>
        </box>
        {hovered ? (
          <box
            onMouseDown={(event) => {
              event.stopPropagation()
              dispatchGlobal({ tabId: tab.id, type: 'close-tab' })
              runSideEffectGlobal({ tabId: tab.id, type: 'close-tab' })
            }}
          >
            <text fg={theme.colors['descriptionForeground']}>×</text>
          </box>
        ) : null}
      </box>
      <box flexDirection="row">
        <text fg={theme.colors['descriptionForeground']}> {label} </text>
        <ActivityIndicator tab={tab} />
      </box>
    </box>
  )
}

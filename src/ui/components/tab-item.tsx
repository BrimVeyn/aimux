import type { TabSession } from '../../state/types'

import { useBusySpinner } from '../hooks/use-busy-spinner'
import { theme } from '../theme'

interface TabItemProps {
  id?: string
  tab: TabSession
  active: boolean
  focused: boolean
  isFocusedInput: boolean
  inLayout?: boolean
}

function getStatusColor(status: TabSession['status']): string {
  switch (status) {
    case 'running':
      return theme.colors['gitDecoration.addedResourceForeground']
    case 'disconnected':
      return theme.colors['editorWarning.foreground']
    case 'error':
      return theme.colors['editorError.foreground']
    case 'exited':
      return theme.colors['editorWarning.foreground']
    default:
      return theme.colors['descriptionForeground']
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
    return focused ? theme.colors['textLink.foreground'] : theme.colors['terminal.ansiMagenta']
  }

  return inLayout
    ? theme.colors['descriptionForeground']
    : theme.colors['editor.lineHighlightBackground']
}

function BusyIndicator() {
  const frame = useBusySpinner()
  return <text fg={theme.colors['textLink.foreground']}>{frame} busy</text>
}

function ActivityIndicator({ isFocusedInput, tab }: { tab: TabSession; isFocusedInput: boolean }) {
  if (tab.status === 'error') {
    return <text fg={theme.colors['editorError.foreground']}>✗ error</text>
  }

  if (tab.status === 'disconnected') {
    return <text fg={theme.colors['editorWarning.foreground']}>⏸ restore</text>
  }

  if (tab.status === 'exited') {
    return <text fg={theme.colors['editorWarning.foreground']}>⏹ exited</text>
  }

  if (isFocusedInput) {
    return <text fg={theme.colors['focusBorder']}>▸ focused</text>
  }

  if (tab.activity === 'busy') {
    return <BusyIndicator />
  }

  if (tab.activity === 'idle') {
    return <text fg={theme.colors['gitDecoration.addedResourceForeground']}>● idle</text>
  }

  return <text fg={getStatusColor(tab.status)}>{tab.status}</text>
}

export function TabItem({ active, focused, id, inLayout, isFocusedInput, tab }: TabItemProps) {
  const label = tab.command.split(' ')[0]
  const isInLayout = inLayout ?? false
  const indicator = getIndicator(active, focused, isInLayout)
  const indicatorColor = getIndicatorColor(active, focused, isInLayout)

  return (
    <box
      id={id}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={0}
      paddingBottom={0}
      backgroundColor={active ? theme.colors['list.activeSelectionBackground'] : undefined}
      flexDirection="column"
      gap={0}
    >
      <box flexDirection="row">
        <text fg={indicatorColor}>{indicator} </text>
        <text
          fg={active ? theme.colors['editor.foreground'] : theme.colors['descriptionForeground']}
        >
          {tab.title}
        </text>
      </box>
      <box flexDirection="row">
        <text fg={theme.colors['descriptionForeground']}> {label} </text>
        <ActivityIndicator tab={tab} isFocusedInput={isFocusedInput} />
      </box>
    </box>
  )
}

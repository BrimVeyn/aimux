import { useEffect, useState } from 'react'

import type { TabSession } from '../../state/types'

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
      return theme.success
    case 'disconnected':
      return theme.warning
    case 'error':
      return theme.danger
    case 'exited':
      return theme.warning
    default:
      return theme.textMuted
  }
}

const BUSY_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const BUSY_FRAME_INTERVAL_MS = 80

function getIndicator(active: boolean, focused: boolean, inLayout: boolean): string {
  if (active) {
    return focused ? '▶' : '◆'
  }

  return inLayout ? '┃' : '│'
}

function getIndicatorColor(active: boolean, focused: boolean, inLayout: boolean): string {
  if (active) {
    return focused ? theme.accent : theme.accentAlt
  }

  return inLayout ? theme.accent : theme.dim
}

function BusyIndicator() {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((prev) => (prev + 1) % BUSY_FRAMES.length)
    }, BUSY_FRAME_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [])

  return <text fg={theme.accent}>{BUSY_FRAMES[frame]} busy</text>
}

function ActivityIndicator({ isFocusedInput, tab }: { tab: TabSession; isFocusedInput: boolean }) {
  if (tab.status === 'error') {
    return <text fg={theme.danger}>✗ error</text>
  }

  if (tab.status === 'disconnected') {
    return <text fg={theme.warning}>⏸ restore</text>
  }

  if (tab.status === 'exited') {
    return <text fg={theme.warning}>⏹ exited</text>
  }

  if (isFocusedInput) {
    return <text fg={theme.borderActive}>▸ focused</text>
  }

  if (tab.activity === 'busy') {
    return <BusyIndicator />
  }

  if (tab.activity === 'idle') {
    return <text fg={theme.success}>● idle</text>
  }

  return <text fg={getStatusColor(tab.status)}>{tab.status}</text>
}

export function TabItem({ active, focused, id, inLayout, isFocusedInput, tab }: TabItemProps) {
  const label = tab.assistant.charAt(0).toUpperCase() + tab.assistant.slice(1).toLowerCase()
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
      border={active}
      borderColor={active ? theme.borderActive : theme.border}
      backgroundColor={active ? theme.panelHighlight : theme.panelMuted}
      flexDirection="column"
      gap={0}
    >
      <box flexDirection="row">
        <text fg={indicatorColor}>{indicator} </text>
        <text fg={active ? theme.text : theme.textMuted}>{tab.title}</text>
      </box>
      <box flexDirection="row">
        <text fg={theme.textMuted}> {label} </text>
        <ActivityIndicator tab={tab} isFocusedInput={isFocusedInput} />
      </box>
    </box>
  )
}

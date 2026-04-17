import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { memo, type ReactNode } from 'react'

import type { TerminalContentOrigin } from '../../input/raw-input-handler'
import type { TabSession, TerminalSnapshot, TerminalSpan } from '../../state/types'

import { logInputDebug } from '../../debug/input-log'
import { theme } from '../theme'

interface TerminalPaneProps {
  tab?: TabSession
  tabId?: string
  focusMode: import('../../state/types').FocusMode
  isActive?: boolean
  contentOrigin: TerminalContentOrigin
  mouseForwardingEnabled: boolean
  localScrollbackEnabled: boolean
  onTerminalMouseEvent: (event: OtuiMouseEvent, origin: TerminalContentOrigin) => void
  onTerminalScrollEvent: (event: OtuiMouseEvent) => void
  onTerminalClick?: (event: OtuiMouseEvent, origin: TerminalContentOrigin, tabId?: string) => void
  onPaneActivate?: (tabId: string) => void
  onSeparatorDrag?: (event: OtuiMouseEvent) => boolean
  onSeparatorDragEnd?: () => void
}

function getTitle(
  tab: TabSession | undefined,
  isActive: boolean,
  focusMode: TerminalPaneProps['focusMode']
): string {
  if (!tab) {
    return 'No active session'
  }

  if (isActive && focusMode === 'terminal-input') {
    return `● ${tab.title} · ${tab.status}`
  }

  if (isActive) {
    return `▸ ${tab.title} · ${tab.status}`
  }

  return `${tab.title} · ${tab.status}`
}

function getBorderColor(isActive: boolean, focusMode: TerminalPaneProps['focusMode']): string {
  if (isActive && focusMode === 'terminal-input') {
    return theme.borderActive
  }

  if (isActive) {
    return theme.accentAlt
  }

  return theme.dim
}

function renderSpan(span: TerminalSpan, key: string): ReactNode {
  let node: ReactNode = span.text

  if (span.underline) {
    node = <u>{node}</u>
  }

  if (span.italic) {
    node = <em>{node}</em>
  }

  if (span.bold) {
    node = <strong>{node}</strong>
  }

  return (
    <span key={key} fg={span.fg ?? theme.text} bg={span.bg}>
      {node}
    </span>
  )
}

interface TerminalViewportProps {
  viewport: TerminalSnapshot | undefined
  buffer: string
}

const TerminalViewport = memo(function TerminalViewport({
  buffer,
  viewport,
}: TerminalViewportProps) {
  if (viewport && viewport.lines.length > 0) {
    const lines = viewport.lines
    return (
      <text fg={theme.text}>
        {lines.map((line, lineIndex) => (
          <span key={`line-${lineIndex}`}>
            {line.spans.map((span, spanIndex) => renderSpan(span, `s-${spanIndex}`))}
            {lineIndex < lines.length - 1 ? '\n' : ''}
          </span>
        ))}
      </text>
    )
  }

  return <text fg={theme.text}>{buffer.length > 0 ? buffer : 'Waiting for session output...'}</text>
})

export function TerminalPane({
  contentOrigin,
  focusMode,
  isActive,
  localScrollbackEnabled,
  mouseForwardingEnabled,
  onPaneActivate,
  onSeparatorDrag,
  onSeparatorDragEnd,
  onTerminalClick,
  onTerminalMouseEvent,
  onTerminalScrollEvent,
  tab,
  tabId,
}: TerminalPaneProps) {
  const paneIsActive = isActive ?? true
  const canForwardMouse = focusMode === 'terminal-input' && !!tab && mouseForwardingEnabled
  const canUseLocalScrollback = focusMode === 'terminal-input' && !!tab && localScrollbackEnabled
  const forwardMouseEvent = (event: OtuiMouseEvent) => {
    if (event.type === 'down') {
      logInputDebug('pane.mouseDown', {
        button: event.button,
        canForward: canForwardMouse,
        eventType: event.type,
        tabId,
        willClick: !canForwardMouse && !!tab && event.button === 0 && !!onTerminalClick,
        x: event.x,
        y: event.y,
      })
    }
    if (event.type === 'drag' && onSeparatorDrag?.(event)) {
      event.preventDefault()
      return
    }
    if (event.type === 'up') {
      onSeparatorDragEnd?.()
    }
    if (tabId && onPaneActivate && event.type === 'down') {
      onPaneActivate(tabId)
    }
    if (!canForwardMouse) {
      if (tab && event.type === 'down' && event.button === 0 && onTerminalClick) {
        onTerminalClick(event, contentOrigin, tabId)
      }
      return
    }

    event.preventDefault()
    event.stopPropagation()
    onTerminalMouseEvent(event, contentOrigin)
  }
  const forwardScrollEvent = (event: OtuiMouseEvent) => {
    if (!canForwardMouse && !canUseLocalScrollback) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    if (canForwardMouse) {
      onTerminalMouseEvent(event, contentOrigin)
      return
    }

    onTerminalScrollEvent(event)
  }
  return (
    <box flexDirection="column" flexGrow={1} gap={0}>
      <box
        border
        borderColor={getBorderColor(paneIsActive, focusMode)}
        title={getTitle(tab, paneIsActive, focusMode)}
        padding={0}
        flexDirection="column"
        flexGrow={1}
        backgroundColor={theme.background}
        onMouseDrag={forwardMouseEvent}
        onMouseScroll={forwardScrollEvent}
        onMouseUp={forwardMouseEvent}
      >
        {!tab ? (
          <box flexGrow={1} justifyContent="center" alignItems="center" flexDirection="column">
            <text fg={theme.dim}>· · ·</text>
            <text fg={theme.textMuted}> </text>
            <box flexDirection="row">
              <text fg={theme.textMuted}>Press </text>
              <text fg={theme.accent}>Ctrl+n</text>
              <text fg={theme.textMuted}> to launch an assistant</text>
            </box>
          </box>
        ) : (
          <box
            flexDirection="column"
            flexGrow={1}
            width="100%"
            onMouseDown={forwardMouseEvent}
            onMouseUp={forwardMouseEvent}
            onMouseDrag={forwardMouseEvent}
            onMouseScroll={forwardScrollEvent}
          >
            <TerminalViewport viewport={tab.viewport} buffer={tab.buffer} />
          </box>
        )}
      </box>
      {tab?.status === 'exited' && tab.exitCode !== undefined ? (
        <text fg={theme.warning}>Process exited with code {tab.exitCode}</text>
      ) : null}
      {tab?.status === 'disconnected' ? (
        <text fg={theme.warning}>Restored snapshot. Press Ctrl+r to restart this session.</text>
      ) : null}
      {tab?.errorMessage ? <text fg={theme.danger}>{tab.errorMessage}</text> : null}
    </box>
  )
}

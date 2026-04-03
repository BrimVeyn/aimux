import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'
import type { ReactNode } from 'react'

import type { TerminalContentOrigin } from '../../input/raw-input-handler'
import type { TabSession, TerminalSpan } from '../../state/types'

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

function getTitle(tab?: TabSession): string {
  if (!tab) {
    return 'No active session'
  }

  return `${tab.title} - ${tab.status}`
}

function renderSpan(span: TerminalSpan, index: number): ReactNode {
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
    <text key={`span-${index}`} fg={span.fg ?? theme.text} bg={span.bg}>
      {node}
    </text>
  )
}

function renderViewport(tab: TabSession): ReactNode {
  if (tab.viewport && tab.viewport.lines.length > 0) {
    return tab.viewport.lines.map((line, lineIndex) => (
      <box key={`line-${lineIndex}`} flexDirection="row" minHeight={1}>
        {line.spans.length > 0 ? (
          line.spans.map((span, spanIndex) => renderSpan(span, spanIndex))
        ) : (
          <text> </text>
        )}
      </box>
    ))
  }

  return (
    <text fg={theme.text}>
      {tab.buffer.length > 0 ? tab.buffer : 'Waiting for session output...'}
    </text>
  )
}

export function TerminalPane({
  tab,
  tabId,
  focusMode,
  isActive,
  contentOrigin,
  mouseForwardingEnabled,
  localScrollbackEnabled,
  onTerminalMouseEvent,
  onTerminalScrollEvent,
  onTerminalClick,
  onPaneActivate,
  onSeparatorDrag,
  onSeparatorDragEnd,
}: TerminalPaneProps) {
  const canForwardMouse = focusMode === 'terminal-input' && !!tab && mouseForwardingEnabled
  const canUseLocalScrollback = focusMode === 'terminal-input' && !!tab && localScrollbackEnabled
  const forwardMouseEvent = (event: OtuiMouseEvent) => {
    if (event.type === 'down') {
      logInputDebug('pane.mouseDown', {
        eventType: event.type,
        button: event.button,
        x: event.x,
        y: event.y,
        canForward: canForwardMouse,
        tabId,
        willClick: !canForwardMouse && !!tab && event.button === 0 && !!onTerminalClick,
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
        borderColor={
          (isActive ?? true) && focusMode === 'terminal-input' ? theme.borderActive : theme.border
        }
        title={getTitle(tab)}
        padding={0}
        flexDirection="column"
        flexGrow={1}
        backgroundColor={theme.background}
        onMouseDrag={forwardMouseEvent}
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
            onMouseDown={forwardMouseEvent}
            onMouseUp={forwardMouseEvent}
            onMouseDrag={forwardMouseEvent}
            onMouseScroll={forwardScrollEvent}
          >
            {renderViewport(tab)}
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

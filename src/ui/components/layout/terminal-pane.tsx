import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { memo, type ReactNode } from 'react'

import type { TerminalContentOrigin } from '../../../input/raw-input-handler'
import type { TabSession, TerminalSnapshot, TerminalSpan } from '../../../state/types'

import { logInputDebug } from '../../../debug/input-log'
import { dispatchGlobal, runSideEffectGlobal } from '../../../state/dispatch-ref'
import { type ContextMenuItem, openContextMenu } from '../../context-menu/controller'
import { getCurrentPalette, getCurrentResolved, usePalette, useTheme } from '../../theme'
import { ContextMenuBox } from '../overlays/context-menu/context-menu-box'

interface TerminalPaneProps {
  tab?: TabSession
  tabId?: string
  focusMode: import('../../../state/types').FocusMode
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
    return 'No active workspace'
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
  const t = getCurrentResolved()
  const p = getCurrentPalette()
  if (isActive && focusMode === 'terminal-input') {
    return p.primary
  }

  if (isActive) {
    return p.accent ?? p.primary
  }

  return t['border-weak-base']
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
    <span key={key} fg={span.fg ?? getCurrentResolved()['text-base']} bg={span.bg}>
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
  const t = useTheme()
  if (viewport && viewport.lines.length > 0) {
    const lines = viewport.lines
    return (
      <text fg={t['text-base']}>
        {lines.map((line, lineIndex) => (
          <span key={`line-${lineIndex}`}>
            {line.spans.map((span, spanIndex) => renderSpan(span, `s-${spanIndex}`))}
            {lineIndex < lines.length - 1 ? '\n' : ''}
          </span>
        ))}
      </text>
    )
  }

  return (
    <text fg={t['text-base']}>
      {buffer.length > 0 ? buffer : 'Waiting for workspace output...'}
    </text>
  )
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
  const t = useTheme()
  const p = usePalette()
  const editorBg = t['background-base']
  const paneIsActive = isActive ?? true
  const canForwardMouse = focusMode === 'terminal-input' && !!tab && mouseForwardingEnabled
  const canUseLocalScrollback = focusMode === 'terminal-input' && !!tab && localScrollbackEnabled
  const rightClickMenu: ContextMenuItem[] | undefined = tabId
    ? [
        [
          'Split vertically',
          () =>
            runSideEffectGlobal({
              direction: 'vertical',
              sourceTabId: tabId,
              type: 'split-pane',
            }),
        ],
        [
          'Split horizontally',
          () =>
            runSideEffectGlobal({
              direction: 'horizontal',
              sourceTabId: tabId,
              type: 'split-pane',
            }),
        ],
        [
          'Close pane',
          () => {
            dispatchGlobal({ tabId, type: 'close-pane' })
            runSideEffectGlobal({ tabId, type: 'close-tab' })
          },
        ],
      ]
    : undefined
  const forwardMouseEvent = (event: OtuiMouseEvent) => {
    if (event.type === 'down' && event.button === 2 && rightClickMenu) {
      event.preventDefault()
      event.stopPropagation()
      openContextMenu(event.x, event.y, rightClickMenu)
      return
    }
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
      <ContextMenuBox
        border
        borderColor={getBorderColor(paneIsActive, focusMode)}
        title={getTitle(tab, paneIsActive, focusMode)}
        padding={0}
        flexDirection="column"
        flexGrow={1}
        backgroundColor={editorBg}
        rightClickMenu={rightClickMenu}
        onMouseDown={forwardMouseEvent}
        onMouseDrag={forwardMouseEvent}
        onMouseScroll={forwardScrollEvent}
        onMouseUp={forwardMouseEvent}
      >
        {!tab ? (
          <box flexGrow={1} justifyContent="center" alignItems="center" flexDirection="column">
            <text fg={t['text-weaker']}>· · ·</text>
            <text fg={t['text-weak']}> </text>
            <box flexDirection="row">
              <text fg={t['text-weak']}>Press </text>
              <text fg={p.primary}>Ctrl+n</text>
              <text fg={t['text-weak']}> to launch an assistant</text>
            </box>
            <box
              flexDirection="row"
              justifyContent="center"
              marginTop={1}
              paddingX={2}
              backgroundColor={t['surface-base-active']}
              onMouseDown={(event) => {
                event.stopPropagation()
                dispatchGlobal({ type: 'open-new-tab-modal' })
              }}
            >
              <text fg={t['text-base']}>New assistant</text>
            </box>
          </box>
        ) : (
          <box
            flexDirection="column"
            flexGrow={1}
            width="100%"
            onMouseDown={(e) => {
              e.stopPropagation()
              forwardMouseEvent(e)
            }}
            onMouseUp={forwardMouseEvent}
            onMouseDrag={forwardMouseEvent}
            onMouseScroll={forwardScrollEvent}
          >
            <TerminalViewport viewport={tab.viewport} buffer={tab.buffer} />
          </box>
        )}
      </ContextMenuBox>
      {tab?.status === 'disconnected' ? (
        <text fg={p.warning}>Restored snapshot. Press Ctrl+r to restart this workspace.</text>
      ) : null}
      {tab?.errorMessage ? <text fg={p.error}>{tab.errorMessage}</text> : null}
    </box>
  )
}

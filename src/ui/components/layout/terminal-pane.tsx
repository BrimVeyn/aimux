import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { memo, type ReactNode } from 'react'

import type { TerminalContentOrigin } from '../../../input/raw-input-handler'
import type { FocusMode, TabSession, TerminalSnapshot, TerminalSpan } from '../../../state/types'

import { type MeasuredPaneRect, usePaneSizeReport } from '../../../app-runtime/use-pane-size-report'
import { logInputDebug } from '../../../debug/input-log'
import { dispatchGlobal, runSideEffectGlobal } from '../../../state/dispatch-ref'
import { type ContextMenuItem, openContextMenu } from '../../context-menu/controller'
import { getCurrentTheme, useTheme } from '../../theme'
import { ContextMenuBox } from '../overlays/context-menu/context-menu-box'

interface TerminalPaneProps {
  tab?: TabSession
  tabId?: string
  focusMode: FocusMode
  isActive?: boolean
  contentOrigin: TerminalContentOrigin
  mouseForwardingEnabled: boolean
  localScrollbackEnabled: boolean
  onTerminalMouseEvent: (event: OtuiMouseEvent, origin: TerminalContentOrigin) => void
  onTerminalScrollEvent: (event: OtuiMouseEvent) => void
  onTerminalClick?: (event: OtuiMouseEvent, origin: TerminalContentOrigin, tabId?: string) => void
  onTerminalDrag?: (event: OtuiMouseEvent, origin: TerminalContentOrigin, tabId?: string) => boolean
  onTerminalMouseUp?: (event: OtuiMouseEvent) => boolean
  onPaneActivate?: (tabId: string) => void
  onSeparatorDrag?: (event: OtuiMouseEvent) => boolean
  onSeparatorDragEnd?: () => void
  onLeftEdgeMouseDown?: (event: OtuiMouseEvent) => boolean
  onMeasure?: (tabId: string, rect: MeasuredPaneRect) => void
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
  const t = getCurrentTheme()
  if (!isActive) return t.border
  return focusMode === 'terminal-input' ? t.accent : t.primary
}

function renderSpan(span: TerminalSpan, key: string): ReactNode {
  let node: ReactNode = span.text

  if (span.underline === true) {
    node = <u>{node}</u>
  }

  if (span.italic === true) {
    node = <em>{node}</em>
  }

  if (span.bold === true) {
    node = <strong>{node}</strong>
  }

  return (
    <span key={key} fg={span.fg ?? getCurrentTheme().text} bg={span.bg}>
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
      <text fg={t.text}>
        {lines.map((line, lineIndex) => (
          <span key={`line-${lineIndex}`}>
            {line.spans.map((span, spanIndex) => renderSpan(span, `s-${spanIndex}`))}
            {lineIndex < lines.length - 1 ? '\n' : ''}
          </span>
        ))}
      </text>
    )
  }

  return <text fg={t.text}>{buffer.length > 0 ? buffer : 'Waiting for workspace output...'}</text>
})

export function TerminalPane({
  contentOrigin,
  focusMode,
  isActive,
  localScrollbackEnabled,
  mouseForwardingEnabled,
  onLeftEdgeMouseDown,
  onMeasure,
  onPaneActivate,
  onSeparatorDrag,
  onSeparatorDragEnd,
  onTerminalClick,
  onTerminalDrag,
  onTerminalMouseEvent,
  onTerminalMouseUp,
  onTerminalScrollEvent,
  tab,
  tabId,
}: TerminalPaneProps) {
  const t = useTheme()
  const setContentBox = usePaneSizeReport(tabId, !!tab, onMeasure)
  const editorBg = t.background
  const paneIsActive = isActive ?? true
  const canForwardMouse = focusMode === 'terminal-input' && !!tab && mouseForwardingEnabled
  const canUseLocalScrollback = focusMode === 'terminal-input' && !!tab && localScrollbackEnabled
  const rightClickMenu: ContextMenuItem[] | undefined =
    tabId != null && tabId !== ''
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
  const isOnPaneBorder = (event: OtuiMouseEvent) =>
    event.x === contentOrigin.x - 1 ||
    event.x === contentOrigin.x + contentOrigin.cols ||
    event.y === contentOrigin.y - 1 ||
    event.y === contentOrigin.y + contentOrigin.rows
  const forwardMouseEvent = (event: OtuiMouseEvent) => {
    if (event.type === 'down' && event.button === 2 && rightClickMenu) {
      event.preventDefault()
      event.stopPropagation()
      openContextMenu(event.x, event.y, rightClickMenu)
      return
    }
    if (
      event.type === 'down' &&
      event.button === 0 &&
      onLeftEdgeMouseDown &&
      event.x === contentOrigin.x - 1
    ) {
      if (onLeftEdgeMouseDown(event)) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
    }
    // Absorb left-button clicks on pane borders — they should not focus the
    // pane or be forwarded to the terminal. This keeps borders available for
    // resize actions (split separators, sidebar edge) without conflicting
    // with focus-on-click behavior in the content area.
    if (event.type === 'down' && event.button === 0 && isOnPaneBorder(event)) {
      event.preventDefault()
      event.stopPropagation()
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
    if (event.type === 'drag') {
      if (onTerminalDrag?.(event, contentOrigin, tabId) === true) {
        event.preventDefault()
        return
      }
      if (onSeparatorDrag?.(event) === true) {
        event.preventDefault()
        return
      }
    }
    if (event.type === 'up') {
      if (onTerminalMouseUp?.(event) === true) {
        event.preventDefault()
      }
      onSeparatorDragEnd?.()
    }
    if (tabId != null && tabId !== '' && onPaneActivate && event.type === 'down') {
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
            <text fg={t.textMuted}>· · ·</text>
            <text fg={t.textMuted}> </text>
            <box flexDirection="row">
              <text fg={t.textMuted}>Press </text>
              <text fg={t.primary}>Ctrl+n</text>
              <text fg={t.textMuted}> to launch an assistant</text>
            </box>
            <box
              flexDirection="row"
              justifyContent="center"
              marginTop={1}
              paddingX={2}
              backgroundColor={t.backgroundPanel}
              onMouseDown={(event) => {
                event.stopPropagation()
                dispatchGlobal({ type: 'open-new-tab-modal' })
              }}
            >
              <text fg={t.text}>New assistant</text>
            </box>
          </box>
        ) : (
          <box
            ref={setContentBox}
            flexDirection="column"
            flexGrow={1}
            width="100%"
            overflow="hidden"
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
      {tab?.status === 'disconnected' || (tab?.errorMessage != null && tab.errorMessage !== '') ? (
        // Absolutely positioned so it overlays the bordered box instead of
        // consuming a flex row. If it took a row, the rendered terminal area
        // would be one line shorter than the size sent to the PTY/xterm,
        // re-introducing the shifted-content / dead-row bug.
        <box position="absolute" bottom={0} left={0} backgroundColor={editorBg}>
          {tab?.status === 'disconnected' ? (
            <text fg={t.warning}>Restored snapshot. Press Ctrl+r to restart this workspace.</text>
          ) : null}
          {tab?.errorMessage != null && tab?.errorMessage !== '' ? (
            <text fg={t.error}>{tab.errorMessage}</text>
          ) : null}
        </box>
      ) : null}
    </box>
  )
}

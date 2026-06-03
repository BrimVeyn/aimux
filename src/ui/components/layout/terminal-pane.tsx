import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { memo, type ReactNode, useCallback, useMemo } from 'react'

import type { TerminalContentOrigin } from '../../../input/raw-input-handler'
import type { JunctionEdgeInfo, JunctionEdges } from '../../../state/layout-tree'
import type { FocusMode, TabSession, TerminalSnapshot, TerminalSpan } from '../../../state/types'

import { type MeasuredPaneRect, usePaneSizeReport } from '../../../app-runtime/use-pane-size-report'
import { logInputDebug } from '../../../debug/input-log'
import { useAppStore } from '../../../state/app-store'
import { dispatchGlobal, runSideEffectGlobal } from '../../../state/dispatch-ref'
import { type ContextMenuItem, openContextMenu } from '../../context-menu/controller'
import { resolvePaletteIndex } from '../../host-palette'
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
  onSeparatorDragStart?: (info: JunctionEdgeInfo) => void
  onLeftEdgeMouseDown?: (event: OtuiMouseEvent) => boolean
  onMeasure?: (tabId: string, rect: MeasuredPaneRect) => void
  junctionEdges?: JunctionEdges
}

function getTitle(
  tab: TabSession | undefined,
  isActive: boolean,
  focusMode: TerminalPaneProps['focusMode'],
  emptyContext: { workspaceName: string; worktreeName: string }
): string {
  if (!tab) {
    const { workspaceName, worktreeName } = emptyContext
    if (workspaceName === '' && worktreeName === '') return 'No active workspace'
    if (worktreeName === '' || worktreeName === workspaceName) {
      return `${workspaceName} · no tabs`
    }
    return `${workspaceName} / ${worktreeName} · no tabs`
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

  // Palette indices are resolved here (not in the daemon) so they pick up
  // the host terminal's actual ANSI palette queried at startup.
  const fg =
    span.fgPalette !== undefined
      ? resolvePaletteIndex(span.fgPalette)
      : (span.fg ?? getCurrentTheme().text)
  const bg = span.bgPalette !== undefined ? resolvePaletteIndex(span.bgPalette) : span.bg

  return (
    <span key={key} fg={fg} bg={bg}>
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
          // Terminal rows are a fixed positional grid; the row index is the identity.
          // eslint-disable-next-line react/no-array-index-key
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
  junctionEdges,
  localScrollbackEnabled,
  mouseForwardingEnabled,
  onLeftEdgeMouseDown,
  onMeasure,
  onPaneActivate,
  onSeparatorDrag,
  onSeparatorDragEnd,
  onSeparatorDragStart,
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
  // These are only used when this pane is rendered without a tab (the
  // top-level pane on a worktree with zero tabs). Selectors return plain
  // strings so re-renders are cheap and bounded to actual name changes.
  const emptyWorkspaceName = useAppStore((s) => {
    const id = s.currentSessionId
    if (id == null || id === '') return ''
    return s.sessions.find((sess) => sess.id === id)?.name ?? ''
  })
  const emptyWorktreeName = useAppStore((s) => {
    const id = s.currentSessionId
    if (id == null || id === '') return ''
    const session = s.sessions.find((sess) => sess.id === id)
    if (!session) return ''
    const activeId =
      session.activeWorktreeId != null && session.activeWorktreeId !== ''
        ? session.activeWorktreeId
        : session.worktrees?.[0]?.id
    if (activeId == null || activeId === '') return ''
    return session.worktrees?.find((w) => w.id === activeId)?.name ?? ''
  })
  const canForwardMouse = focusMode === 'terminal-input' && !!tab && mouseForwardingEnabled
  const canUseLocalScrollback = focusMode === 'terminal-input' && !!tab && localScrollbackEnabled
  const rightClickMenu = useMemo<ContextMenuItem[] | undefined>(
    () =>
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
        : undefined,
    [tabId]
  )
  const isOnPaneBorder = useCallback(
    (event: OtuiMouseEvent) =>
      event.x === contentOrigin.x - 1 ||
      event.x === contentOrigin.x + contentOrigin.cols ||
      event.y === contentOrigin.y - 1 ||
      event.y === contentOrigin.y + contentOrigin.rows,
    [contentOrigin]
  )
  const getJunctionSideAt = useCallback(
    (event: OtuiMouseEvent): keyof JunctionEdges | null => {
      if (event.x === contentOrigin.x - 1) return 'left'
      if (event.x === contentOrigin.x + contentOrigin.cols) return 'right'
      if (event.y === contentOrigin.y - 1) return 'top'
      if (event.y === contentOrigin.y + contentOrigin.rows) return 'bottom'
      return null
    },
    [contentOrigin]
  )
  const forwardMouseEvent = useCallback(
    (event: OtuiMouseEvent) => {
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
      if (event.type === 'down' && event.button === 0 && junctionEdges && onSeparatorDragStart) {
        const side = getJunctionSideAt(event)
        if (side !== null) {
          const info = junctionEdges[side]
          if (info) {
            event.preventDefault()
            event.stopPropagation()
            onSeparatorDragStart(info)
            return
          }
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
    },
    [
      canForwardMouse,
      contentOrigin,
      getJunctionSideAt,
      isOnPaneBorder,
      junctionEdges,
      onLeftEdgeMouseDown,
      onPaneActivate,
      onSeparatorDrag,
      onSeparatorDragEnd,
      onSeparatorDragStart,
      onTerminalClick,
      onTerminalDrag,
      onTerminalMouseEvent,
      onTerminalMouseUp,
      rightClickMenu,
      tab,
      tabId,
    ]
  )
  const forwardScrollEvent = useCallback(
    (event: OtuiMouseEvent) => {
      // opentui's processMouseEvent dispatches a scroll to the deepest renderable
      // (the <text> inside this box) BEFORE bubbling up to our handler.
      // TextBufferRenderable's built-in onMouseEvent unconditionally calls
      // handleScroll, which mutates its private _scrollY. preventDefault on the
      // bubbled event can't roll that back — the scroll already happened. And
      // nothing in React ever resets _scrollY for the lifetime of the renderable.
      //
      // Net effect: every wheel event over the terminal nudges the rendered
      // text away from state.viewport.lines by one wheel step. The drift
      // accumulates until the user refreshes aimux (re-mounts the text).
      // Reset _scrollY here, right after the child finished scrolling.
      const scrollTarget = event.target
      if (scrollTarget !== null && typeof scrollTarget === 'object') {
        const currentScrollY = Reflect.get(scrollTarget, 'scrollY')
        if (typeof currentScrollY === 'number' && currentScrollY !== 0) {
          try {
            Reflect.set(scrollTarget, 'scrollY', 0)
          } catch {
            // Not all renderables expose a setter; best-effort only.
          }
        }
        const currentScrollX = Reflect.get(scrollTarget, 'scrollX')
        if (typeof currentScrollX === 'number' && currentScrollX !== 0) {
          try {
            Reflect.set(scrollTarget, 'scrollX', 0)
          } catch {
            // Not all renderables expose a setter; best-effort only.
          }
        }
      }

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
    },
    [
      canForwardMouse,
      canUseLocalScrollback,
      contentOrigin,
      onTerminalMouseEvent,
      onTerminalScrollEvent,
    ]
  )
  const handleNoTabMouseDown = useCallback((event: OtuiMouseEvent) => {
    event.stopPropagation()
    dispatchGlobal({ type: 'open-new-tab-modal' })
  }, [])
  const handleContentMouseDown = useCallback(
    (e: OtuiMouseEvent) => {
      e.stopPropagation()
      forwardMouseEvent(e)
    },
    [forwardMouseEvent]
  )
  return (
    <box flexDirection="column" flexGrow={1} gap={0}>
      <ContextMenuBox
        border
        borderColor={getBorderColor(paneIsActive, focusMode)}
        title={getTitle(tab, paneIsActive, focusMode, {
          workspaceName: emptyWorkspaceName,
          worktreeName: emptyWorktreeName,
        })}
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
            {emptyWorkspaceName !== '' ? (
              <box flexDirection="row">
                <text fg={t.text}>{emptyWorkspaceName}</text>
                {emptyWorktreeName !== '' && emptyWorktreeName !== emptyWorkspaceName ? (
                  <>
                    <text fg={t.textMuted}> / </text>
                    <text fg={t.text}>{emptyWorktreeName}</text>
                  </>
                ) : null}
              </box>
            ) : null}
            <text fg={t.textMuted}>has no tabs</text>
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
              onMouseDown={handleNoTabMouseDown}
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
            onMouseDown={handleContentMouseDown}
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

import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { useEffect, useRef } from 'react'

import type { TerminalContentOrigin } from '../input/raw-input-handler'
import type { SessionBackend } from '../session-backend/types'
import type { SplitDirection } from '../state/layout-tree'
import type { AppAction, AppState, TabSession, TerminalLine } from '../state/types'

import { logInputDebug } from '../debug/input-log'
import { MultiClickDetector } from '../input/multi-click-detector'
import { extractStreamText, getLineText } from '../input/terminal-text-extraction'
import { copyToSystemClipboard } from '../platform/clipboard'
import {
  type ClickSelectionResult,
  computeRangeFromLineText,
  getViewportAnchor,
  isPositionedNode,
  type MultiClickMode,
  resolveClickSelection,
} from './click-selection-resolver'
import { requestRenderUpTree } from './render-invalidation'
import {
  type AnchoredRatioDragState,
  type AxisDragState,
  getAnchoredRatioFromDrag,
  getAxisDeltaFromDrag,
  getSplitRatioFromDrag,
  type SplitDragState,
} from './split-drag-controller'
import { getForwardedMouseSequence, getScrollViewportDelta } from './terminal-mouse-adapter'

type ResizeDragState =
  | ({ kind: 'split' } & SplitDragState)
  | ({ initialWidth: number; kind: 'sidebar' } & AxisDragState)
  | ({ initialWidth: number; kind: 'git-pane'; side: 'left' | 'right' } & AxisDragState)
  | ({ kind: 'embedded-git'; position: 'top' | 'bottom' } & AnchoredRatioDragState)

interface MultiClickDragState {
  mode: MultiClickMode
  tabId: string
  target: unknown
  baseX: number
  baseY: number
  // Absolute buffer rows (viewportY + viewportRow). Stable across scroll so
  // auto-scroll can move the viewport without losing the anchor.
  anchorAbsRow: number
  anchorStartCol: number
  anchorEndCol: number
  focusAbsRow: number
  focusCol: number
  // Last raw screen position so the viewport-change effect can re-extend the
  // selection even when no drag event has fired (mouse held still at the edge).
  lastEventScreenY: number
  lastEventScreenX: number
  // Cache of every viewport row seen during the drag, indexed by absolute row.
  // Source of truth for clipboard text when the selection spans rows that have
  // scrolled out of view.
  capturedLines: Map<number, TerminalLine>
  autoScrollTimer: ReturnType<typeof setInterval> | null
  autoScrollDir: -1 | 0 | 1
}

interface UseMouseHandlersOptions {
  state: AppState
  dispatch: (action: AppAction) => void
  backend: SessionBackend
  renderer: {
    clearSelection(): void
    hasSelection?: boolean
    startSelection(target: unknown, x: number, y: number): void
    updateSelection(target: unknown, x: number, y: number, opts: { finishDragging: boolean }): void
  }
  activeMouseForwardingEnabled: boolean
  activeLocalScrollbackEnabled: boolean
}

const MIN_MULTI_CLICK_SELECTION_COUNT = 2
const AUTO_SCROLL_INTERVAL_MS = 40

function getTargetTerminalTabId(
  focusMode: AppState['focusMode'],
  activeTabId: string | null,
  isEnabled: boolean
): string | null {
  if (focusMode !== 'terminal-input' || !activeTabId || !isEnabled) {
    return null
  }

  return activeTabId
}

function captureViewportLines(drag: MultiClickDragState, tab: TabSession): void {
  if (!tab.viewport) return
  const startAbs = tab.viewport.viewportY
  for (let i = 0; i < tab.viewport.lines.length; i++) {
    const line = tab.viewport.lines[i]
    if (line) drag.capturedLines.set(startAbs + i, line)
  }
}

function isForwardSelection(drag: MultiClickDragState): boolean {
  return (
    drag.focusAbsRow > drag.anchorAbsRow ||
    (drag.focusAbsRow === drag.anchorAbsRow && drag.focusCol >= drag.anchorEndCol)
  )
}

function renderMultiClickSelection(
  renderer: UseMouseHandlersOptions['renderer'],
  drag: MultiClickDragState,
  viewportY: number,
  finishDragging: boolean
): void {
  const forward = isForwardSelection(drag)
  const anchorCol = forward ? drag.anchorStartCol : drag.anchorEndCol
  const anchorScreenY = drag.baseY + (drag.anchorAbsRow - viewportY)
  const focusScreenY = drag.baseY + (drag.focusAbsRow - viewportY)
  renderer.startSelection(drag.target, drag.baseX + anchorCol, anchorScreenY)
  renderer.updateSelection(drag.target, drag.baseX + drag.focusCol, focusScreenY, {
    finishDragging,
  })
  requestRenderUpTree(drag.target)
}

function applyMultiClickInitialSelection(
  renderer: UseMouseHandlersOptions['renderer'],
  selection: ClickSelectionResult
): void {
  renderer.clearSelection()
  renderer.startSelection(selection.target, selection.baseX + selection.startCol, selection.eventY)
  // finishDragging:false keeps the renderer in drag mode so subsequent
  // mouse-drag events can extend the selection through our drag handler.
  renderer.updateSelection(selection.target, selection.baseX + selection.endCol, selection.eventY, {
    finishDragging: false,
  })
  requestRenderUpTree(selection.target)
  copyToSystemClipboard(selection.selectedText)
}

export function useMouseHandlers({
  activeLocalScrollbackEnabled,
  activeMouseForwardingEnabled,
  backend,
  dispatch,
  renderer,
  state,
}: UseMouseHandlersOptions) {
  const separatorDragRef = useRef<ResizeDragState | null>(null)
  const multiClickRef = useRef(new MultiClickDetector())
  const multiClickDragRef = useRef<MultiClickDragState | null>(null)
  // State is captured by reference in the React closure; we need a ref so
  // drag/up handlers and the auto-scroll timer see the freshest tab viewport.
  const stateRef = useRef(state)
  stateRef.current = state

  const clearAutoScroll = (drag: MultiClickDragState) => {
    if (drag.autoScrollTimer) {
      clearInterval(drag.autoScrollTimer)
    }
    drag.autoScrollTimer = null
    drag.autoScrollDir = 0
  }

  const canScroll = (tab: TabSession | undefined, dir: -1 | 1): boolean => {
    if (!tab?.viewport) return false
    if (dir < 0) return tab.viewport.viewportY > 0
    return tab.viewport.viewportY < tab.viewport.baseY
  }

  const startAutoScroll = (drag: MultiClickDragState, dir: -1 | 1) => {
    if (drag.autoScrollDir === dir && drag.autoScrollTimer) return
    clearAutoScroll(drag)
    drag.autoScrollDir = dir
    drag.autoScrollTimer = setInterval(() => {
      const tab = stateRef.current.tabs.find((t: TabSession) => t.id === drag.tabId)
      if (!canScroll(tab, dir)) {
        clearAutoScroll(drag)
        return
      }
      backend.scrollViewport(drag.tabId, dir)
      // The snapshot dispatch will trigger the viewport-change effect below,
      // which recaptures lines and re-extends the selection focus.
    }, AUTO_SCROLL_INTERVAL_MS)
  }

  // Unmount safety: never leave a setInterval running past the hook's life.
  useEffect(
    () => () => {
      const drag = multiClickDragRef.current
      if (drag) clearAutoScroll(drag)
      multiClickDragRef.current = null
    },
    []
  )

  // Abort the drag (and its auto-scroll loop) when the user switches to a
  // different tab mid-drag: the original tab is no longer visible and we'd
  // otherwise keep pumping scroll commands into a background buffer.
  useEffect(() => {
    const drag = multiClickDragRef.current
    if (!drag) return
    if (drag.tabId !== state.activeTabId) {
      clearAutoScroll(drag)
      multiClickDragRef.current = null
    }
  }, [state.activeTabId])

  // Re-extend selection and recapture viewport lines on every snapshot change
  // while a multi-click drag is in progress. This is what lets auto-scroll
  // grow the selection even when the mouse hasn't moved.
  useEffect(() => {
    const drag = multiClickDragRef.current
    if (!drag) return
    const tab = stateRef.current.tabs.find((t: TabSession) => t.id === drag.tabId)
    if (!tab?.viewport) return

    captureViewportLines(drag, tab)

    const viewportRows = tab.viewport.lines.length
    if (viewportRows === 0) return

    const dragViewportRow = Math.max(
      0,
      Math.min(viewportRows - 1, drag.lastEventScreenY - drag.baseY)
    )
    const newFocusAbs = tab.viewport.viewportY + dragViewportRow
    const focusLine = drag.capturedLines.get(newFocusAbs)
    const focusLineText = focusLine ? getLineText(focusLine) : ''
    const focusDragCol = drag.lastEventScreenX - drag.baseX
    const range = computeRangeFromLineText(focusLineText, focusDragCol, drag.mode)
    const focusStart = range?.startCol ?? Math.max(0, focusDragCol)
    const focusEnd = range?.endCol ?? Math.max(0, focusDragCol)

    drag.focusAbsRow = newFocusAbs
    const forward =
      newFocusAbs > drag.anchorAbsRow ||
      (newFocusAbs === drag.anchorAbsRow && focusEnd >= drag.anchorEndCol)
    drag.focusCol = forward ? focusEnd : focusStart

    renderMultiClickSelection(renderer, drag, tab.viewport.viewportY, false)
  }, [state.tabs, renderer])

  const handleTerminalMouseEvent = (event: OtuiMouseEvent, origin: TerminalContentOrigin) => {
    const targetTabId = getTargetTerminalTabId(
      state.focusMode,
      state.activeTabId,
      activeMouseForwardingEnabled
    )
    if (!targetTabId) {
      return
    }

    const sequence = getForwardedMouseSequence(event, origin)
    if (!sequence) {
      return
    }

    backend.write(targetTabId, sequence)
  }

  const handleTerminalScrollEvent = (event: OtuiMouseEvent) => {
    const targetTabId = getTargetTerminalTabId(state.focusMode, state.activeTabId, true)
    if (!targetTabId || activeMouseForwardingEnabled || !activeLocalScrollbackEnabled) {
      return
    }

    // Wheel scrolls can jump several lines at once and race with the
    // captured-lines map, leaving gaps that produce blank rows in the final
    // clipboard. Ignore them while a multi-click drag is being held — the
    // dedicated auto-scroll loop is what's expected to drive the viewport.
    if (multiClickDragRef.current) {
      return
    }

    const delta = getScrollViewportDelta(event)
    if (delta === null) {
      return
    }

    backend.scrollViewport(targetTabId, delta)
  }

  const handleSplitResize = (tabId: string, ratio: number, axis: SplitDirection) => {
    dispatch({ axis, ratio, tabId, type: 'set-split-ratio' })
  }

  const handleSeparatorDragStart = (info: {
    tabId: string
    direction: SplitDirection
    screenStart: number
    totalSize: number
  }) => {
    separatorDragRef.current = { kind: 'split', ...info }
  }

  const handleSidebarResizeStart = (info: { initialWidth: number; screenStart: number }) => {
    separatorDragRef.current = {
      axis: 'x',
      initialWidth: info.initialWidth,
      kind: 'sidebar',
      screenStart: info.screenStart,
    }
  }

  const handleGitPaneResizeStart = (info: {
    initialWidth: number
    screenStart: number
    side: 'left' | 'right'
  }) => {
    separatorDragRef.current = {
      axis: 'x',
      initialWidth: info.initialWidth,
      kind: 'git-pane',
      screenStart: info.screenStart,
      side: info.side,
    }
  }

  const handleEmbeddedGitResizeStart = (info: {
    containerStart: number
    position: 'top' | 'bottom'
    totalSize: number
  }) => {
    separatorDragRef.current = {
      anchor: info.position === 'top' ? 'start' : 'end',
      axis: 'y',
      kind: 'embedded-git',
      position: info.position,
      screenStart: info.containerStart,
      totalSize: info.totalSize,
    }
  }

  const handleSeparatorDrag = (event: OtuiMouseEvent): boolean => {
    const drag = separatorDragRef.current
    if (!drag) {
      return false
    }

    switch (drag.kind) {
      case 'split': {
        const newRatio = getSplitRatioFromDrag(event, drag)
        dispatch({
          axis: drag.direction,
          ratio: newRatio,
          tabId: drag.tabId,
          type: 'set-split-ratio',
        })
        break
      }
      case 'sidebar': {
        const nextWidth = Math.round(drag.initialWidth + getAxisDeltaFromDrag(event, drag))
        dispatch({ type: 'set-sidebar-width', width: nextWidth })
        break
      }
      case 'git-pane': {
        const delta = getAxisDeltaFromDrag(event, drag)
        const direction = drag.side === 'left' ? 1 : -1
        const nextWidth = drag.initialWidth + delta * direction
        dispatch({
          ratio: nextWidth / 80,
          target: 'pane',
          type: 'set-git-pane-ratio',
        })
        break
      }
      case 'embedded-git': {
        dispatch({
          ratio: getAnchoredRatioFromDrag(event, drag),
          target: 'embedded',
          type: 'set-git-pane-ratio',
        })
        break
      }
    }
    return true
  }

  const handleSeparatorDragEnd = () => {
    separatorDragRef.current = null
  }

  const handlePaneActivate = (tabId: string) => {
    if (tabId !== state.activeTabId) {
      dispatch({ tabId, type: 'set-active-tab' })
    }
    if (state.focusMode !== 'terminal-input') {
      dispatch({ focusMode: 'terminal-input', type: 'set-focus-mode' })
    }
  }

  const handleTerminalClick = (
    event: OtuiMouseEvent,
    _origin: TerminalContentOrigin,
    tabId?: string
  ) => {
    const targetTabId = tabId ?? state.activeTabId
    if (!targetTabId || !event.target) {
      return
    }

    const clickCount = multiClickRef.current.track(event.x, event.y)
    if (clickCount < MIN_MULTI_CLICK_SELECTION_COUNT) {
      // Single-click: clear any stale multi-click drag state so a fresh
      // char-level drag from opentui's default handler isn't extended by us.
      const stale = multiClickDragRef.current
      if (stale) clearAutoScroll(stale)
      multiClickDragRef.current = null
      return
    }

    const tab = state.tabs.find((t: TabSession) => t.id === targetTabId)
    const selection = resolveClickSelection(event, targetTabId, tab, clickCount)
    if (!selection || !tab?.viewport) {
      return
    }

    event.preventDefault()
    applyMultiClickInitialSelection(renderer, selection)

    const anchor = getViewportAnchor(event)
    if (anchor) {
      const anchorAbsRow = tab.viewport.viewportY + selection.row
      const drag: MultiClickDragState = {
        anchorAbsRow,
        anchorEndCol: selection.endCol,
        anchorStartCol: selection.startCol,
        autoScrollDir: 0,
        autoScrollTimer: null,
        baseX: anchor.baseX,
        baseY: anchor.baseY,
        capturedLines: new Map(),
        focusAbsRow: anchorAbsRow,
        focusCol: selection.endCol,
        lastEventScreenX: event.x,
        lastEventScreenY: event.y,
        mode: selection.mode,
        tabId: targetTabId,
        target: selection.target,
      }
      captureViewportLines(drag, tab)
      multiClickDragRef.current = drag
    }

    logInputDebug('click.done', {
      hasSelection: !!renderer.hasSelection,
      mode: selection.mode,
      targetSelectable: isPositionedNode(event.target) ? !!event.target.selectable : false,
    })
  }

  const handleTerminalDrag = (
    event: OtuiMouseEvent,
    _origin: TerminalContentOrigin,
    _tabId?: string
  ): boolean => {
    const drag = multiClickDragRef.current
    if (!drag) return false

    const tab = stateRef.current.tabs.find((t: TabSession) => t.id === drag.tabId)
    if (!tab?.viewport) return true

    drag.lastEventScreenX = event.x
    drag.lastEventScreenY = event.y
    captureViewportLines(drag, tab)

    const viewportRows = tab.viewport.lines.length
    if (viewportRows === 0) return true

    const rawRow = event.y - drag.baseY
    const dragViewportRow = Math.max(0, Math.min(viewportRows - 1, rawRow))
    const dragAbsRow = tab.viewport.viewportY + dragViewportRow
    const dragCol = event.x - drag.baseX

    const focusLine = drag.capturedLines.get(dragAbsRow)
    const focusLineText = focusLine ? getLineText(focusLine) : ''
    const range = computeRangeFromLineText(focusLineText, dragCol, drag.mode)
    const focusStart = range?.startCol ?? Math.max(0, dragCol)
    const focusEnd = range?.endCol ?? Math.max(0, dragCol)

    drag.focusAbsRow = dragAbsRow
    const forward =
      dragAbsRow > drag.anchorAbsRow ||
      (dragAbsRow === drag.anchorAbsRow && focusEnd >= drag.anchorEndCol)
    drag.focusCol = forward ? focusEnd : focusStart

    renderMultiClickSelection(renderer, drag, tab.viewport.viewportY, false)

    // Edge detection: trigger auto-scroll when the pointer sits at (or beyond)
    // the top/bottom row of the viewport.
    let dir: -1 | 0 | 1 = 0
    if (rawRow <= 0) dir = -1
    else if (rawRow >= viewportRows - 1) dir = 1

    if (dir === 0) {
      clearAutoScroll(drag)
    } else if (canScroll(tab, dir)) {
      startAutoScroll(drag, dir)
    } else {
      clearAutoScroll(drag)
    }

    return true
  }

  const handleTerminalMouseUp = (_event: OtuiMouseEvent): boolean => {
    const drag = multiClickDragRef.current
    if (!drag) return false

    clearAutoScroll(drag)

    const tab = stateRef.current.tabs.find((t: TabSession) => t.id === drag.tabId)
    if (tab?.viewport) {
      captureViewportLines(drag, tab)
      renderMultiClickSelection(renderer, drag, tab.viewport.viewportY, true)
    }

    const forward = isForwardSelection(drag)
    const anchorCol = forward ? drag.anchorStartCol : drag.anchorEndCol

    const startAbs = Math.min(drag.anchorAbsRow, drag.focusAbsRow)
    const endAbs = Math.max(drag.anchorAbsRow, drag.focusAbsRow)
    const lines: TerminalLine[] = []
    let missingRows = 0
    for (let abs = startAbs; abs <= endAbs; abs++) {
      const line = drag.capturedLines.get(abs)
      if (line) {
        lines.push(line)
      } else {
        missingRows += 1
        lines.push({ spans: [] })
      }
    }
    if (missingRows > 0) {
      // Snapshot coalescing (remote backend, fast scroll bursts) can let the
      // selection cover rows we never captured. The output gets blank lines
      // here — surface it for debugging instead of silently corrupting paste.
      logInputDebug('multiclick.clipboardGap', {
        endAbs,
        missingRows,
        startAbs,
        totalRows: endAbs - startAbs + 1,
      })
    }
    const anchorIdx = drag.anchorAbsRow - startAbs
    const focusIdx = drag.focusAbsRow - startAbs
    const text = extractStreamText(lines, anchorIdx, anchorCol, focusIdx, drag.focusCol)
    if (text.length > 0) {
      copyToSystemClipboard(text)
    }

    multiClickDragRef.current = null
    return true
  }

  return {
    handleEmbeddedGitResizeStart,
    handleGitPaneResizeStart,
    handlePaneActivate,
    handleSeparatorDrag,
    handleSeparatorDragEnd,
    handleSeparatorDragStart,
    handleSidebarResizeStart,
    handleSplitResize,
    handleTerminalClick,
    handleTerminalDrag,
    handleTerminalMouseEvent,
    handleTerminalMouseUp,
    handleTerminalScrollEvent,
  }
}

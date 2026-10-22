import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { useEffect, useRef } from 'react'

import type { TerminalContentOrigin } from '../input/raw-input-handler'
import type { SessionBackend } from '../session-backend/types'
import type { AppAction } from '../state/actions'
import type { SplitDirection } from '../state/layout-tree'
import type { AppState, BarSide, TabSession, TerminalLine } from '../state/types'

import { logInputDebug } from '../debug/input-log'
import { MULTI_CLICK_TIMEOUT_MS, MultiClickDetector } from '../input/multi-click-detector'
import {
  type CellPos,
  type CellRange,
  expandAt,
  isSameRange,
  type SelectionMode,
  selectionText,
  unionRange,
} from '../input/terminal-selection'
import { getLinkAtColumn } from '../input/terminal-text-extraction'
import { copyToSystemClipboard } from '../platform/clipboard'
import { openUrl } from '../platform/open-url'
import { bump } from '../services/aimux-counters'
import {
  type AxisDragState,
  getAxisDeltaFromDrag,
  getRatioFromDrag,
  getSplitRatioFromDrag,
  type RatioDragState,
  type SplitDragState,
} from './split-drag-controller'
import { getForwardedMouseSequence, getScrollViewportDelta } from './terminal-mouse-adapter'
import { setTerminalSelection } from './terminal-selection-store'

type ResizeDragState =
  | ({ kind: 'split' } & SplitDragState)
  | ({ initialWidth: number; kind: 'bar'; side: BarSide } & AxisDragState)
  | ({ index: number; kind: 'bar-boundary'; side: BarSide } & RatioDragState)

interface SelectionDragState {
  tabId: string
  mode: SelectionMode
  origin: TerminalContentOrigin
  // What the press itself selected. Each drag step selects it plus the focus.
  anchor: CellRange
  range: CellRange | null
  // Last pointer position, so a snapshot can re-extend the selection while the
  // mouse is held still at an edge and auto-scroll moves the text under it.
  pointerX: number
  pointerY: number
  // Every row seen during the drag, by absolute row. The copy reads these, so a
  // selection taller than the viewport still copies whole.
  rows: Map<number, TerminalLine>
  autoScrollTimer: ReturnType<typeof setInterval> | null
  autoScrollDir: -1 | 0 | 1
  // A scroll command was sent to the backend and we are still waiting for the
  // snapshot it produces. Gates the next auto-scroll tick so the backend's
  // viewportY can never run ahead of the frontend mirror (which all the
  // selection math reads) — the source of the copy-offset drift.
  autoScrollPending: boolean
  // The drag tab's viewport object last handled by the snapshot effect. Used
  // to ignore snapshot churn from *other* tabs: updateTab keeps unchanged tabs
  // by reference, so an unrelated tab's output must not clear autoScrollPending
  // or re-extend the selection.
  lastProcessedViewport: TabSession['viewport']
}

interface UseMouseHandlersOptions {
  state: AppState
  dispatch: (action: AppAction) => void
  backend: SessionBackend
  renderer: {
    clearSelection(): void
    copyToClipboardOSC52(text: string): boolean
  }
  activeMouseForwardingEnabled: boolean
  activeLocalScrollbackEnabled: boolean
}

const AUTO_SCROLL_INTERVAL_MS = 40
const SELECTION_MODES: readonly SelectionMode[] = ['char', 'word', 'line']

function getTargetTerminalTabId(
  focusMode: AppState['focusMode'],
  activeTabId: string | null,
  isEnabled: boolean
): string | null {
  if (focusMode !== 'terminal-input' || activeTabId == null || activeTabId === '' || !isEnabled) {
    return null
  }

  return activeTabId
}

function captureRows(drag: SelectionDragState, tab: TabSession): void {
  if (!tab.viewport) return
  const startAbs = tab.viewport.viewportY
  for (let i = 0; i < tab.viewport.lines.length; i++) {
    const line = tab.viewport.lines[i]
    if (line) drag.rows.set(startAbs + i, line)
  }
}

/** The buffer cell under the pointer, clamped into the viewport. */
function pointerCell(drag: SelectionDragState, tab: TabSession): CellPos | null {
  const viewport = tab.viewport
  if (!viewport || viewport.lines.length === 0) return null
  const row = Math.max(0, Math.min(viewport.lines.length - 1, drag.pointerY - drag.origin.y))
  const col = Math.max(0, Math.min(drag.origin.cols - 1, drag.pointerX - drag.origin.x))
  return { col, row: viewport.viewportY + row }
}

function extendSelection(drag: SelectionDragState, tab: TabSession): void {
  const pos = pointerCell(drag, tab)
  if (!pos) return
  const focus = expandAt((row) => drag.rows.get(row), pos, drag.mode)
  // A press and release on one cell is a click, not a one-character selection.
  drag.range =
    drag.mode === 'char' && isSameRange(focus, drag.anchor) ? null : unionRange(drag.anchor, focus)
  setTerminalSelection(drag.range && { tabId: drag.tabId, ...drag.range })
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
  const selectionDragRef = useRef<SelectionDragState | null>(null)
  // URL under a single-click mouse-down; opened on a release at the same cell.
  const pendingLinkRef = useRef<{ url: string; x: number; y: number } | null>(null)
  const linkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // State is captured by reference in the React closure; we need a ref so
  // drag/up handlers and the auto-scroll timer see the freshest tab viewport.
  const stateRef = useRef(state)
  stateRef.current = state

  const clearAutoScroll = (drag: SelectionDragState) => {
    if (drag.autoScrollTimer) {
      clearInterval(drag.autoScrollTimer)
    }
    drag.autoScrollTimer = null
    drag.autoScrollDir = 0
    drag.autoScrollPending = false
  }

  const canScroll = (tab: TabSession | undefined, dir: -1 | 1): boolean => {
    if (!tab?.viewport) return false
    if (dir < 0) return tab.viewport.viewportY > 0
    return tab.viewport.viewportY < tab.viewport.baseY
  }

  const startAutoScroll = (drag: SelectionDragState, dir: -1 | 1) => {
    if (drag.autoScrollDir === dir && drag.autoScrollTimer) return
    clearAutoScroll(drag)
    drag.autoScrollDir = dir
    drag.autoScrollTimer = setInterval(() => {
      // Wait for the previous scroll's snapshot before issuing the next one, so
      // the backend viewportY stays in lockstep with the frontend mirror.
      if (drag.autoScrollPending) {
        return
      }
      const tab = stateRef.current.tabs.find((t: TabSession) => t.id === drag.tabId)
      if (!canScroll(tab, dir)) {
        clearAutoScroll(drag)
        return
      }
      drag.autoScrollPending = true
      backend.scrollViewport(drag.tabId, dir)
      // The snapshot dispatch will trigger the viewport-change effect below,
      // which clears autoScrollPending, recaptures rows, and re-extends focus.
    }, AUTO_SCROLL_INTERVAL_MS)
  }

  // Unmount safety: never leave a setInterval running past the hook's life.
  useEffect(
    () => () => {
      if (linkTimerRef.current) clearTimeout(linkTimerRef.current)
      const drag = selectionDragRef.current
      if (drag) clearAutoScroll(drag)
      selectionDragRef.current = null
    },
    []
  )

  // Abort the drag (and its auto-scroll loop) when the user switches to a
  // different tab mid-drag: the original tab is no longer visible and we'd
  // otherwise keep pumping scroll commands into a background buffer.
  useEffect(() => {
    const drag = selectionDragRef.current
    if (!drag) return
    if (drag.tabId !== state.activeTabId) {
      clearAutoScroll(drag)
      selectionDragRef.current = null
    }
  }, [state.activeTabId])

  // Recapture rows and re-extend the selection on every snapshot of the drag
  // tab. This is what lets auto-scroll (or the wheel) grow the selection while
  // the mouse holds still.
  useEffect(() => {
    const drag = selectionDragRef.current
    if (!drag) return
    const tab = stateRef.current.tabs.find((t: TabSession) => t.id === drag.tabId)
    // The effect fires on any tab's snapshot (state.tabs is a fresh array), but
    // the drag tab's viewport object only changes when *its* snapshot lands.
    // Ignore churn from other tabs so the auto-scroll lockstep stays 1:1.
    if (!tab?.viewport || tab.viewport === drag.lastProcessedViewport) return
    drag.lastProcessedViewport = tab.viewport

    // A fresh snapshot for the drag tab landed: the backend has caught up, so
    // the auto-scroll loop may issue its next step.
    drag.autoScrollPending = false

    captureRows(drag, tab)
    extendSelection(drag, tab)
  }, [state.tabs])

  // Arms a URL open for a single left click; handleTerminalMouseUp fires it.
  // A second click within the multi-click window cancels the pending open, so
  // double-clicking a URL selects it instead.
  const armLinkOpen = (
    event: OtuiMouseEvent,
    origin: TerminalContentOrigin,
    tab: TabSession | undefined,
    clickCount: number
  ) => {
    if (linkTimerRef.current) clearTimeout(linkTimerRef.current)
    linkTimerRef.current = null
    pendingLinkRef.current = null
    if (clickCount !== 1) return

    const col = event.x - origin.x
    const row = event.y - origin.y
    const line = tab?.viewport?.lines[row]
    const url = line ? getLinkAtColumn(line, col) : null
    logInputDebug('link.down', { col, row, url })
    if (url != null) pendingLinkRef.current = { url, x: event.x, y: event.y }
  }

  const handleTerminalMouseEvent = (event: OtuiMouseEvent, origin: TerminalContentOrigin) => {
    const targetTabId = getTargetTerminalTabId(
      state.focusMode,
      state.activeTabId,
      activeMouseForwardingEnabled
    )
    if (!(targetTabId != null && targetTabId !== '')) {
      return
    }

    // Mouse-capturing apps (Claude Code) get the click too, but URLs in their
    // output still open: the host terminal can't see them behind our capture.
    if (event.type === 'down' && event.button === 0) {
      const tab = state.tabs.find((t: TabSession) => t.id === targetTabId)
      armLinkOpen(event, origin, tab, multiClickRef.current.track(event.x, event.y))
    }

    const sequence = getForwardedMouseSequence(event, origin)
    if (!(sequence != null && sequence !== '')) {
      return
    }

    backend.write(targetTabId, sequence)
  }

  const handleTerminalScrollEvent = (event: OtuiMouseEvent) => {
    const targetTabId = getTargetTerminalTabId(state.focusMode, state.activeTabId, true)
    if (
      targetTabId == null ||
      targetTabId === '' ||
      activeMouseForwardingEnabled ||
      !activeLocalScrollbackEnabled
    ) {
      return
    }

    const delta = getScrollViewportDelta(event)
    if (delta === null) {
      return
    }

    bump('scrollLines', Math.abs(delta))
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

  const handleBarResizeStart = (info: {
    initialWidth: number
    screenStart: number
    side: BarSide
  }) => {
    separatorDragRef.current = {
      axis: 'x',
      initialWidth: info.initialWidth,
      kind: 'bar',
      screenStart: info.screenStart,
      side: info.side,
    }
  }

  const handleBarBoundaryResizeStart = (info: {
    containerStart: number
    index: number
    side: BarSide
    totalSize: number
  }) => {
    separatorDragRef.current = {
      axis: 'y',
      index: info.index,
      kind: 'bar-boundary',
      screenStart: info.containerStart,
      side: info.side,
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
      case 'bar': {
        // The right bar grows as the cursor moves left, hence the flipped sign.
        const delta = getAxisDeltaFromDrag(event, drag) * (drag.side === 'left' ? 1 : -1)
        dispatch({
          side: drag.side,
          type: 'set-bar-width',
          width: Math.round(drag.initialWidth + delta),
        })
        break
      }
      case 'bar-boundary': {
        dispatch({
          index: drag.index,
          ratio: getRatioFromDrag(event, drag),
          side: drag.side,
          type: 'set-bar-boundary',
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

  // A press starts a selection: one click selects by cell, two by word, three
  // by line, and dragging extends it in the same unit.
  const handleTerminalClick = (
    event: OtuiMouseEvent,
    origin: TerminalContentOrigin,
    tabId?: string
  ) => {
    const targetTabId = tabId ?? state.activeTabId
    if (targetTabId == null || targetTabId === '') {
      return
    }

    const tab = state.tabs.find((t: TabSession) => t.id === targetTabId)
    const clickCount = multiClickRef.current.track(event.x, event.y)
    armLinkOpen(event, origin, tab, clickCount)

    const previous = selectionDragRef.current
    if (previous) clearAutoScroll(previous)
    selectionDragRef.current = null
    // Any other selection goes, ours or one opentui drew in a diff or modal.
    renderer.clearSelection()
    setTerminalSelection(null)

    const drag: SelectionDragState = {
      anchor: { end: { col: 0, row: 0 }, start: { col: 0, row: 0 } },
      autoScrollDir: 0,
      autoScrollPending: false,
      autoScrollTimer: null,
      lastProcessedViewport: tab?.viewport,
      mode: SELECTION_MODES[Math.min(clickCount, SELECTION_MODES.length) - 1] ?? 'char',
      origin,
      pointerX: event.x,
      pointerY: event.y,
      range: null,
      rows: new Map(),
      tabId: targetTabId,
    }
    const pos = tab ? pointerCell(drag, tab) : null
    if (!tab || !pos) return
    captureRows(drag, tab)
    drag.anchor = expandAt((row) => drag.rows.get(row), pos, drag.mode)
    selectionDragRef.current = drag
    extendSelection(drag, tab)
  }

  const handleTerminalDrag = (
    event: OtuiMouseEvent,
    _origin: TerminalContentOrigin,
    _tabId?: string
  ): boolean => {
    pendingLinkRef.current = null
    const drag = selectionDragRef.current
    if (!drag) return false

    const tab = stateRef.current.tabs.find((t: TabSession) => t.id === drag.tabId)
    if (!tab?.viewport) return true

    drag.pointerX = event.x
    drag.pointerY = event.y
    captureRows(drag, tab)
    extendSelection(drag, tab)

    // Past the top or bottom edge, the text scrolls under the pointer.
    const row = event.y - drag.origin.y
    let dir: -1 | 0 | 1 = 0
    if (row < 0) dir = -1
    else if (row >= tab.viewport.lines.length) dir = 1

    if (dir !== 0 && canScroll(tab, dir)) {
      startAutoScroll(drag, dir)
    } else {
      clearAutoScroll(drag)
    }

    return true
  }

  const handleTerminalMouseUp = (event: OtuiMouseEvent): boolean => {
    const link = pendingLinkRef.current
    pendingLinkRef.current = null
    if (link && event.x === link.x && event.y === link.y) {
      linkTimerRef.current = setTimeout(() => {
        linkTimerRef.current = null
        logInputDebug('link.open', { url: link.url })
        openUrl(link.url)
      }, MULTI_CLICK_TIMEOUT_MS)
    }

    const drag = selectionDragRef.current
    if (!drag) return false

    clearAutoScroll(drag)
    selectionDragRef.current = null
    if (!drag.range) return true

    const text = selectionText((row) => drag.rows.get(row), drag.range)
    if (text.length > 0) {
      renderer.copyToClipboardOSC52(text)
      copyToSystemClipboard(text)
    }
    return true
  }

  return {
    handleBarBoundaryResizeStart,
    handleBarResizeStart,
    handlePaneActivate,
    handleSeparatorDrag,
    handleSeparatorDragEnd,
    handleSeparatorDragStart,
    handleSplitResize,
    handleTerminalClick,
    handleTerminalDrag,
    handleTerminalMouseEvent,
    handleTerminalMouseUp,
    handleTerminalScrollEvent,
  }
}

import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { useRef } from 'react'

import type { TerminalContentOrigin } from '../input/raw-input-handler'
import type { SessionBackend } from '../session-backend/types'
import type { SplitDirection } from '../state/layout-tree'
import type { AppAction, AppState, TabSession } from '../state/types'

import { logInputDebug } from '../debug/input-log'
import { MultiClickDetector } from '../input/multi-click-detector'
import { extractStreamText } from '../input/terminal-text-extraction'
import { copyToSystemClipboard } from '../platform/clipboard'
import {
  type ClickSelectionResult,
  computeMultiClickRange,
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
  anchorRow: number
  anchorStartCol: number
  anchorEndCol: number
  // Tracks the last extended (focus) row/col so mouseUp can build the final
  // clipboard text without re-querying the pointer.
  focusRow: number
  focusCol: number
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

function applyMultiClickSelection(
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
  // drag/up handlers see the freshest tab viewport for clipboard extraction.
  const stateRef = useRef(state)
  stateRef.current = state

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
      multiClickDragRef.current = null
      return
    }

    const tab = state.tabs.find((t: TabSession) => t.id === targetTabId)
    const selection = resolveClickSelection(event, targetTabId, tab, clickCount)
    if (!selection) {
      return
    }

    event.preventDefault()
    applyMultiClickSelection(renderer, selection)

    const anchor = getViewportAnchor(event)
    if (anchor) {
      multiClickDragRef.current = {
        anchorEndCol: selection.endCol,
        anchorRow: selection.row,
        anchorStartCol: selection.startCol,
        baseX: anchor.baseX,
        baseY: anchor.baseY,
        focusCol: selection.endCol,
        focusRow: selection.row,
        mode: selection.mode,
        tabId: targetTabId,
        target: selection.target,
      }
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

    // Use the anchor's target/origin so dragging across pane boundaries
    // doesn't snap the selection to a different viewport.
    const dragCol = event.x - drag.baseX
    const rawRow = event.y - drag.baseY
    const maxRow = Math.max(0, tab.viewport.lines.length - 1)
    const dragRow = Math.max(0, Math.min(maxRow, rawRow))

    const focusRange = computeMultiClickRange(tab, dragRow, dragCol, drag.mode)
    // Word mode on whitespace: fall back to the exact column so the selection
    // still extends to the cursor instead of getting stuck on the last word.
    const focusStart = focusRange?.startCol ?? Math.max(0, dragCol)
    const focusEnd = focusRange?.endCol ?? Math.max(0, dragCol)

    const isForward =
      dragRow > drag.anchorRow || (dragRow === drag.anchorRow && focusEnd >= drag.anchorEndCol)

    const anchorCol = isForward ? drag.anchorStartCol : drag.anchorEndCol
    const focusCol = isForward ? focusEnd : focusStart

    drag.focusRow = dragRow
    drag.focusCol = focusCol

    renderer.startSelection(drag.target, drag.baseX + anchorCol, drag.baseY + drag.anchorRow)
    renderer.updateSelection(drag.target, drag.baseX + focusCol, drag.baseY + dragRow, {
      finishDragging: false,
    })
    requestRenderUpTree(drag.target)

    return true
  }

  const handleTerminalMouseUp = (_event: OtuiMouseEvent): boolean => {
    const drag = multiClickDragRef.current
    if (!drag) return false

    const tab = stateRef.current.tabs.find((t: TabSession) => t.id === drag.tabId)
    const isForward =
      drag.focusRow > drag.anchorRow ||
      (drag.focusRow === drag.anchorRow && drag.focusCol >= drag.anchorEndCol)

    const anchorCol = isForward ? drag.anchorStartCol : drag.anchorEndCol

    renderer.updateSelection(drag.target, drag.baseX + drag.focusCol, drag.baseY + drag.focusRow, {
      finishDragging: true,
    })
    requestRenderUpTree(drag.target)

    if (tab?.viewport?.lines.length) {
      const text = extractStreamText(
        tab.viewport.lines,
        drag.anchorRow,
        anchorCol,
        drag.focusRow,
        drag.focusCol
      )
      if (text.length > 0) {
        copyToSystemClipboard(text)
      }
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

import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { useRef } from 'react'

import type { TerminalContentOrigin } from '../input/raw-input-handler'
import type { SessionBackend } from '../session-backend/types'
import type { SplitDirection } from '../state/layout-tree'
import type { AppAction, AppState, TabSession } from '../state/types'

import { logInputDebug } from '../debug/input-log'
import { MultiClickDetector } from '../input/multi-click-detector'
import { copyToSystemClipboard } from '../platform/clipboard'
import {
  type ClickSelectionResult,
  isPositionedNode,
  resolveClickSelection,
} from './click-selection-resolver'
import { requestRenderUpTree } from './render-invalidation'
import { getSplitRatioFromDrag, type SplitDragState } from './split-drag-controller'
import { getForwardedMouseSequence, getScrollViewportDelta } from './terminal-mouse-adapter'

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

function applyResolvedSelection(
  renderer: UseMouseHandlersOptions['renderer'],
  selection: ClickSelectionResult
): void {
  renderer.clearSelection()
  renderer.startSelection(selection.target, selection.baseX + selection.startCol, selection.eventY)
  renderer.updateSelection(selection.target, selection.baseX + selection.endCol, selection.eventY, {
    finishDragging: true,
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
  const separatorDragRef = useRef<SplitDragState | null>(null)
  const multiClickRef = useRef(new MultiClickDetector())

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
    separatorDragRef.current = info
  }

  const handleSeparatorDrag = (event: OtuiMouseEvent): boolean => {
    const drag = separatorDragRef.current
    if (!drag) {
      return false
    }

    const newRatio = getSplitRatioFromDrag(event, drag)
    dispatch({ axis: drag.direction, ratio: newRatio, tabId: drag.tabId, type: 'set-split-ratio' })
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
      return
    }

    const tab = state.tabs.find((t: TabSession) => t.id === targetTabId)
    const selection = resolveClickSelection(event, targetTabId, tab, clickCount)
    if (!selection) {
      return
    }

    event.preventDefault()
    applyResolvedSelection(renderer, selection)

    logInputDebug('click.done', {
      hasSelection: !!renderer.hasSelection,
      targetSelectable: isPositionedNode(event.target) ? !!event.target.selectable : false,
    })
  }

  return {
    handlePaneActivate,
    handleSeparatorDrag,
    handleSeparatorDragEnd,
    handleSeparatorDragStart,
    handleSplitResize,
    handleTerminalClick,
    handleTerminalMouseEvent,
    handleTerminalScrollEvent,
  }
}

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
  const separatorDragRef = useRef<ResizeDragState | null>(null)
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
    handleEmbeddedGitResizeStart,
    handleGitPaneResizeStart,
    handlePaneActivate,
    handleSeparatorDrag,
    handleSeparatorDragEnd,
    handleSeparatorDragStart,
    handleSidebarResizeStart,
    handleSplitResize,
    handleTerminalClick,
    handleTerminalMouseEvent,
    handleTerminalScrollEvent,
  }
}

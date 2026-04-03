import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { useRef } from 'react'

import type { TerminalContentOrigin } from '../input/raw-input-handler'
import type { SessionBackend } from '../session-backend/types'
import type { SplitDirection } from '../state/layout-tree'
import type { AppAction, AppState, TabSession } from '../state/types'

import { logInputDebug } from '../debug/input-log'
import { encodeMouseEventForPty } from '../input/mouse-forwarding'
import { MultiClickDetector } from '../input/multi-click-detector'
import { getLineText, getWordAtColumn } from '../input/terminal-text-extraction'
import { copyToSystemClipboard } from '../platform/clipboard'

interface UseMouseHandlersOptions {
  state: AppState
  dispatch: (action: AppAction) => void
  backend: SessionBackend
  renderer: {
    clearSelection(): void
    startSelection(target: unknown, x: number, y: number): void
    updateSelection(target: unknown, x: number, y: number, opts: { finishDragging: boolean }): void
  }
  activeMouseForwardingEnabled: boolean
  activeLocalScrollbackEnabled: boolean
}

export function useMouseHandlers({
  state,
  dispatch,
  backend,
  renderer,
  activeMouseForwardingEnabled,
  activeLocalScrollbackEnabled,
}: UseMouseHandlersOptions) {
  const separatorDragRef = useRef<{
    tabId: string
    direction: SplitDirection
    screenStart: number
    totalSize: number
  } | null>(null)
  const multiClickRef = useRef(new MultiClickDetector())

  const handleTerminalMouseEvent = (event: OtuiMouseEvent, origin: TerminalContentOrigin) => {
    if (
      state.focusMode !== 'terminal-input' ||
      !state.activeTabId ||
      !activeMouseForwardingEnabled
    ) {
      return
    }

    const sequence = encodeMouseEventForPty(event, origin)
    if (!sequence) {
      return
    }

    backend.write(state.activeTabId, sequence)
  }

  const handleTerminalScrollEvent = (event: OtuiMouseEvent) => {
    if (state.focusMode !== 'terminal-input' || !state.activeTabId) {
      return
    }

    if (activeMouseForwardingEnabled) {
      return
    }

    if (!activeLocalScrollbackEnabled || event.type !== 'scroll') {
      return
    }

    const direction = event.scroll?.direction
    if (direction === 'up') {
      backend.scrollViewport(state.activeTabId, -3)
    } else if (direction === 'down') {
      backend.scrollViewport(state.activeTabId, 3)
    }
  }

  const handleSplitResize = (tabId: string, ratio: number, axis: SplitDirection) => {
    dispatch({ type: 'set-split-ratio', tabId, ratio, axis })
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
    if (!drag) return false
    const pos = drag.direction === 'vertical' ? event.x : event.y
    const newRatio = (pos - drag.screenStart) / drag.totalSize
    dispatch({ type: 'set-split-ratio', tabId: drag.tabId, ratio: newRatio, axis: drag.direction })
    return true
  }

  const handleSeparatorDragEnd = () => {
    separatorDragRef.current = null
  }

  const handlePaneActivate = (tabId: string) => {
    if (tabId !== state.activeTabId) {
      dispatch({ type: 'set-active-tab', tabId })
    }
    if (state.focusMode !== 'terminal-input') {
      dispatch({ type: 'set-focus-mode', focusMode: 'terminal-input' })
    }
  }

  const handleTerminalClick = (
    event: OtuiMouseEvent,
    origin: TerminalContentOrigin,
    tabId?: string
  ) => {
    const targetTabId = tabId ?? state.activeTabId
    if (!targetTabId || !event.target) {
      return
    }

    const col = event.x - origin.x
    const row = event.y - origin.y
    const clickCount = multiClickRef.current.track(event.x, event.y)

    logInputDebug('click.detect', {
      eventX: event.x,
      eventY: event.y,
      originX: origin.x,
      originY: origin.y,
      col,
      row,
      clickCount,
      targetId: event.target?.id,
      targetX: (event.target as any)?.x,
      targetY: (event.target as any)?.y,
      targetW: (event.target as any)?.width,
      targetCtor: event.target?.constructor?.name,
    })

    if (clickCount < 2) {
      return
    }

    const tab = state.tabs.find((t: TabSession) => t.id === targetTabId)
    if (!tab?.viewport?.lines[row]) {
      return
    }

    const line = tab.viewport.lines[row]
    const lineBox = event.target.parent
    if (!lineBox) {
      logInputDebug('click.noLineBox', { targetId: event.target?.id })
      return
    }
    const baseX = lineBox.x

    logInputDebug('click.lineBox', {
      lineBoxId: lineBox?.id,
      lineBoxX: (lineBox as any)?.x,
      lineBoxY: (lineBox as any)?.y,
      lineBoxW: (lineBox as any)?.width,
      lineBoxCtor: lineBox?.constructor?.name,
      grandParentId: (lineBox as any)?.parent?.id,
      grandParentX: (lineBox as any)?.parent?.x,
      grandParentCtor: (lineBox as any)?.parent?.constructor?.name,
    })

    const lineText = getLineText(line)
    let selectedText: string
    let startCol: number
    let endCol: number

    if (clickCount === 2) {
      const word = getWordAtColumn(lineText, col)
      if (word.text.length === 0) {
        return
      }
      selectedText = word.text
      startCol = word.startCol
      endCol = word.endCol
    } else {
      selectedText = lineText
      startCol = 0
      endCol = lineText.length
    }

    logInputDebug('click.selection', {
      clickCount,
      selectedText,
      startCol,
      endCol,
      baseX,
      startX: baseX + startCol,
      endX: baseX + endCol,
      y: event.y,
      lineText,
      spanCount: line.spans.length,
      spanTexts: line.spans.map((s) => s.text),
      spanStyles: line.spans.map((s) => ({
        bold: s.bold,
        italic: s.italic,
        underline: s.underline,
      })),
    })

    // Find the TextRenderables at start/end positions by walking the
    // line box children.  This mimics native drag-selection where start
    // and end can be different renderables, allowing multi-span selection.
    const startScreenX = baseX + startCol
    const endScreenX = baseX + endCol
    const children = (lineBox as any).getChildren() as Array<{ x: number; width: number }>
    const startTarget =
      children.find((c: any) => c.x <= startScreenX && startScreenX < c.x + c.width) ??
      children[0] ??
      event.target
    const endTarget =
      children.find((c: any) => c.x < endScreenX && endScreenX <= c.x + c.width) ??
      children[children.length - 1] ??
      event.target

    event.preventDefault()
    renderer.clearSelection()
    renderer.startSelection(startTarget, startScreenX, event.y)
    renderer.updateSelection(endTarget, endScreenX, event.y, {
      finishDragging: true,
    })
    copyToSystemClipboard(selectedText)
  }

  return {
    handleTerminalMouseEvent,
    handleTerminalScrollEvent,
    handleTerminalClick,
    handlePaneActivate,
    handleSplitResize,
    handleSeparatorDragStart,
    handleSeparatorDrag,
    handleSeparatorDragEnd,
  }
}

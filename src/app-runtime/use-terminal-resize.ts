import { type MutableRefObject, useEffect, useMemo, useRef } from 'react'

import type { TerminalContentOrigin } from '../input/raw-input-handler'
import type { SessionBackend } from '../session-backend/types'
import type { AppAction, AppState } from '../state/types'

import {
  createTerminalBounds,
  forEachSplitPaneRect,
  toTerminalContentSize,
} from '../state/layout-resize'

const MAIN_AREA_HORIZONTAL_CHROME = 2
const MAIN_AREA_VERTICAL_PADDING = 0
const STATUS_BAR_HEIGHT = 4
const TERMINAL_PANE_VERTICAL_CHROME = 2
const MIN_TERMINAL_ROWS = 1
const MIN_TERMINAL_COLS = 20
const RESIZE_ACTIVITY_SETTLE_MS = 500

function getTerminalBounds(cols: number, rows: number) {
  return createTerminalBounds(cols, rows)
}

function resizeSplitTabs(
  backend: SessionBackend,
  layoutTrees: AppState['layoutTrees'],
  tabs: AppState['tabs'],
  cols: number,
  rows: number
): void {
  const bounds = getTerminalBounds(cols, rows)
  const resizedTabIds = new Set<string>()

  forEachSplitPaneRect(Object.values(layoutTrees), bounds, (tabId, rect) => {
    const size = toTerminalContentSize(rect)
    backend.resizeTab(tabId, size.cols, size.rows)
    resizedTabIds.add(tabId)
  })

  for (const tab of tabs) {
    if (!resizedTabIds.has(tab.id)) {
      backend.resizeTab(tab.id, cols, rows)
    }
  }
}

interface UseTerminalResizeOptions {
  state: AppState
  dispatch: (action: AppAction) => void
  backend: SessionBackend
  dimensions: { width: number; height: number }
  contentOriginRef: MutableRefObject<TerminalContentOrigin>
  resizingRef: MutableRefObject<boolean>
}

export function useTerminalResize({
  backend,
  contentOriginRef,
  dimensions,
  dispatch,
  resizingRef,
  state,
}: UseTerminalResizeOptions) {
  const resizingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const terminalSize = useMemo(() => {
    const sidebarWidth = state.sidebar.visible ? state.sidebar.width + 1 : 0
    const reservedRows =
      MAIN_AREA_VERTICAL_PADDING + STATUS_BAR_HEIGHT + TERMINAL_PANE_VERTICAL_CHROME
    const cols = Math.max(
      MIN_TERMINAL_COLS,
      Math.floor(dimensions.width - sidebarWidth - MAIN_AREA_HORIZONTAL_CHROME)
    )
    const rows = Math.max(MIN_TERMINAL_ROWS, Math.floor(dimensions.height - reservedRows))

    contentOriginRef.current = {
      cols,
      rows,
      x: sidebarWidth + 1,
      y: 1,
    }

    return { cols, rows }
  }, [
    contentOriginRef,
    dimensions.height,
    dimensions.width,
    state.sidebar.visible,
    state.sidebar.width,
  ])

  useEffect(() => {
    dispatch({
      cols: terminalSize.cols,
      rows: terminalSize.rows,
      type: 'set-terminal-size',
    })
    resizingRef.current = true
    if (resizingTimerRef.current) {
      clearTimeout(resizingTimerRef.current)
    }
    const trees = Object.values(state.layoutTrees)
    const hasSplits = trees.some((t) => t.type === 'split')
    if (hasSplits) {
      resizeSplitTabs(backend, state.layoutTrees, state.tabs, terminalSize.cols, terminalSize.rows)
    } else {
      backend.resizeAll(terminalSize.cols, terminalSize.rows)
    }
    resizingTimerRef.current = setTimeout(() => {
      resizingRef.current = false
      resizingTimerRef.current = null
    }, RESIZE_ACTIVITY_SETTLE_MS)
  }, [
    backend,
    dispatch,
    resizingRef,
    terminalSize.cols,
    terminalSize.rows,
    state.layoutTrees,
    state.tabs,
  ])

  return terminalSize
}

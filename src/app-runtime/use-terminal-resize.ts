import { type MutableRefObject, useEffect, useLayoutEffect, useMemo, useRef } from 'react'

import type { TerminalContentOrigin } from '../input/raw-input-handler'
import type { SessionBackend } from '../session-backend/types'
import type { AppAction, AppState, ScrollIntent } from '../state/types'

import {
  createTerminalBounds,
  forEachSplitPaneRect,
  toTerminalContentSize,
} from '../state/layout-resize'

const MAIN_AREA_HORIZONTAL_CHROME = 2
const MAIN_AREA_VERTICAL_PADDING = 0
const STATUS_BAR_HEIGHT = 2
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
  tabIds: string[],
  cols: number,
  rows: number,
  intents: Map<string, ScrollIntent>,
  options?: { sync?: boolean }
): void {
  const bounds = getTerminalBounds(cols, rows)
  const resizedTabIds = new Set<string>()

  forEachSplitPaneRect(Object.values(layoutTrees), bounds, (tabId, rect) => {
    const size = toTerminalContentSize(rect)
    backend.resizeTab(tabId, size.cols, size.rows, intents.get(tabId), options)
    resizedTabIds.add(tabId)
  })

  for (const id of tabIds) {
    if (!resizedTabIds.has(id)) {
      backend.resizeTab(id, cols, rows, intents.get(id), options)
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

interface RunResizeCascadeArgs {
  backend: SessionBackend
  dispatch: (action: AppAction) => void
  resizingRef: MutableRefObject<boolean>
  resizingTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>
  cols: number
  rows: number
  layoutTrees: AppState['layoutTrees']
  stableTabIds: string[]
  intents: Map<string, ScrollIntent>
  sync: boolean
}

function runResizeCascade({
  backend,
  cols,
  dispatch,
  intents,
  layoutTrees,
  resizingRef,
  resizingTimerRef,
  rows,
  stableTabIds,
  sync,
}: RunResizeCascadeArgs): void {
  dispatch({ cols, rows, type: 'set-terminal-size' })
  resizingRef.current = true
  if (resizingTimerRef.current) {
    clearTimeout(resizingTimerRef.current)
  }
  const trees = Object.values(layoutTrees)
  const hasSplits = trees.some((t) => t.type === 'split')
  const options = sync ? { sync: true } : undefined
  if (hasSplits) {
    resizeSplitTabs(backend, layoutTrees, stableTabIds, cols, rows, intents, options)
  } else {
    backend.resizeAll(cols, rows, intents, options)
  }
  resizingTimerRef.current = setTimeout(() => {
    resizingRef.current = false
    resizingTimerRef.current = null
  }, RESIZE_ACTIVITY_SETTLE_MS)
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
  const tabIdsRef = useRef<string[]>([])
  const intentsRef = useRef<Map<string, ScrollIntent>>(new Map())
  const handledBySyncRef = useRef(false)
  const sidebarMountedRef = useRef(false)

  const currentTabIds = state.tabs.map((t) => t.id)
  const tabIdsChanged =
    currentTabIds.length !== tabIdsRef.current.length ||
    currentTabIds.some((id, i) => id !== tabIdsRef.current[i])
  if (tabIdsChanged) {
    tabIdsRef.current = currentTabIds
  }
  const stableTabIds = tabIdsRef.current

  intentsRef.current = new Map(
    state.tabs
      .filter((t): t is typeof t & { scrollIntent: ScrollIntent } => t.scrollIntent !== undefined)
      .map((t) => [t.id, t.scrollIntent])
  )

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

  useLayoutEffect(() => {
    if (!sidebarMountedRef.current) {
      sidebarMountedRef.current = true
      return
    }
    runResizeCascade({
      backend,
      cols: terminalSize.cols,
      dispatch,
      intents: intentsRef.current,
      layoutTrees: state.layoutTrees,
      resizingRef,
      resizingTimerRef,
      rows: terminalSize.rows,
      stableTabIds,
      sync: true,
    })
    handledBySyncRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.sidebar.visible, state.sidebar.width])

  useEffect(() => {
    if (handledBySyncRef.current) {
      handledBySyncRef.current = false
      return
    }
    runResizeCascade({
      backend,
      cols: terminalSize.cols,
      dispatch,
      intents: intentsRef.current,
      layoutTrees: state.layoutTrees,
      resizingRef,
      resizingTimerRef,
      rows: terminalSize.rows,
      stableTabIds,
      sync: false,
    })
  }, [
    backend,
    dispatch,
    resizingRef,
    terminalSize.cols,
    terminalSize.rows,
    state.layoutTrees,
    stableTabIds,
  ])

  return terminalSize
}

import { flushSync } from '@opentui/react'
import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react'

import type { TerminalContentOrigin } from '../input/raw-input-handler'
import type { SessionBackend } from '../session-backend/types'
import type { AppAction, AppState } from '../state/types'
import type { MeasuredPaneRect } from './use-pane-size-report'

import { getGitPaneWidthFromRatio } from '../state/git-pane-sizing'
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

// Must match the clamps PtyManager applies in resizeSession/resizeAll, so the
// size we record as "applied" is the size the PTY/xterm actually adopt — a
// mismatch here would make the dedupe never settle and resize every frame.
const PTY_MIN_COLS = 20
const PTY_MIN_ROWS = 8

function getTerminalBounds(cols: number, rows: number) {
  return createTerminalBounds(cols, rows)
}

export function resizeSplitTabs(
  backend: SessionBackend,
  layoutTrees: AppState['layoutTrees'],
  tabIds: string[],
  cols: number,
  rows: number,
  options?: { sync?: boolean }
): void {
  const bounds = getTerminalBounds(cols, rows)
  const resizedTabIds = new Set<string>()

  forEachSplitPaneRect(Object.values(layoutTrees), bounds, (tabId, rect) => {
    const size = toTerminalContentSize(rect)
    backend.resizeTab(tabId, size.cols, size.rows, options)
    resizedTabIds.add(tabId)
  })

  for (const id of tabIds) {
    if (!resizedTabIds.has(id)) {
      backend.resizeTab(id, cols, rows, options)
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
  sync: boolean
}

function runResizeCascade({
  backend,
  cols,
  dispatch,
  layoutTrees,
  resizingRef,
  resizingTimerRef,
  rows,
  stableTabIds,
  sync,
}: RunResizeCascadeArgs): void {
  const trees = Object.values(layoutTrees)
  const hasSplits = trees.some((t) => t.type === 'split')
  const options = sync ? { sync: true } : undefined
  const runCascade = () => {
    dispatch({ cols, rows, type: 'set-terminal-size' })
    resizingRef.current = true
    if (resizingTimerRef.current) {
      clearTimeout(resizingTimerRef.current)
    }
    if (hasSplits) {
      resizeSplitTabs(backend, layoutTrees, stableTabIds, cols, rows, options)
    } else {
      backend.resizeAll(cols, rows, options)
    }
    resizingTimerRef.current = setTimeout(() => {
      resizingRef.current = false
      resizingTimerRef.current = null
    }, RESIZE_ACTIVITY_SETTLE_MS)
  }
  if (sync) {
    flushSync(runCascade)
  } else {
    runCascade()
  }
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

  const activeTabIdRef = useRef(state.activeTabId)
  activeTabIdRef.current = state.activeTabId
  // Last size we pushed to the backend per tab, used to dedupe the measurement
  // loop so an unchanged box never re-triggers a resize.
  const measuredRef = useRef(new Map<string, { cols: number; rows: number }>())

  // Closed measurement loop: the rendered terminal content box reports its
  // real geometry; that — not the hardcoded chrome model below — is the
  // authority for the PTY/xterm size and the mouse-mapping origin. The model
  // cascade still runs for bootstrap and for tabs whose pane isn't mounted yet;
  // this corrects any residual divergence (status-bar wrap, split rounding, …).
  const handleMeasure = useCallback(
    (tabId: string, rect: MeasuredPaneRect): void => {
      const cols = Math.max(PTY_MIN_COLS, rect.cols)
      const rows = Math.max(PTY_MIN_ROWS, rect.rows)
      const isActive = tabId === activeTabIdRef.current
      if (isActive) {
        contentOriginRef.current = { cols, rows, x: rect.x, y: rect.y }
      }
      const prev = measuredRef.current.get(tabId)
      if (prev && prev.cols === cols && prev.rows === rows) {
        return
      }
      measuredRef.current.set(tabId, { cols, rows })
      backend.resizeTab(tabId, cols, rows)
    },
    [backend, contentOriginRef]
  )

  const gitPaneInPaneMode = state.gitPane.mode === 'pane' && state.gitPane.visible
  const terminalSize = useMemo(() => {
    const sidebarWidth = state.sidebar.visible ? state.sidebar.width : 0
    const sessionBarRows = state.sessionBar.visible ? 1 : 0
    const sessionBarTopOffset =
      state.sessionBar.visible && state.sessionBar.position === 'top' ? 1 : 0
    const reservedRows =
      MAIN_AREA_VERTICAL_PADDING +
      STATUS_BAR_HEIGHT +
      TERMINAL_PANE_VERTICAL_CHROME +
      sessionBarRows
    const gitPaneWidth = gitPaneInPaneMode ? getGitPaneWidthFromRatio(state.gitPane.paneRatio) : 0
    const gitOnLeft = gitPaneInPaneMode && state.gitPane.position === 'left'
    const cols = Math.max(
      MIN_TERMINAL_COLS,
      Math.floor(dimensions.width - sidebarWidth - gitPaneWidth - MAIN_AREA_HORIZONTAL_CHROME)
    )
    const rows = Math.max(MIN_TERMINAL_ROWS, Math.floor(dimensions.height - reservedRows))

    contentOriginRef.current = {
      cols,
      rows,
      x: sidebarWidth + (gitOnLeft ? gitPaneWidth : 0) + 1,
      y: 1 + sessionBarTopOffset,
    }

    return { cols, rows }
  }, [
    contentOriginRef,
    dimensions.height,
    dimensions.width,
    state.sidebar.visible,
    state.sidebar.width,
    state.sessionBar.visible,
    state.sessionBar.position,
    gitPaneInPaneMode,
    state.gitPane.position,
    state.gitPane.paneRatio,
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
      layoutTrees: state.layoutTrees,
      resizingRef,
      resizingTimerRef,
      rows: terminalSize.rows,
      stableTabIds,
      sync: true,
    })
    handledBySyncRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.sidebar.visible,
    state.sidebar.width,
    state.sessionBar.visible,
    state.sessionBar.position,
    gitPaneInPaneMode,
    state.gitPane.position,
    state.gitPane.paneRatio,
  ])

  useEffect(() => {
    if (handledBySyncRef.current) {
      handledBySyncRef.current = false
      return
    }
    runResizeCascade({
      backend,
      cols: terminalSize.cols,
      dispatch,
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

  return { cols: terminalSize.cols, onMeasure: handleMeasure, rows: terminalSize.rows }
}

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

import { getBarWidth } from '../state/bars'
import {
  createTerminalBounds,
  forEachSplitPaneRect,
  toTerminalContentSize,
} from '../state/layout-resize'
import { getTreeForTab } from '../state/layout-tree'

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

function resizeSplitTabs(
  backend: SessionBackend,
  layoutTrees: AppState['layoutTrees'],
  tabIds: string[],
  cols: number,
  rows: number,
  options?: { sync?: boolean },
  skipTabId?: string | null
): void {
  const bounds = getTerminalBounds(cols, rows)
  const resizedTabIds = new Set<string>()

  forEachSplitPaneRect(Object.values(layoutTrees), bounds, (tabId, rect) => {
    if (skipTabId != null && tabId === skipTabId) {
      resizedTabIds.add(tabId)
      return
    }
    const size = toTerminalContentSize(rect)
    backend.resizeTab(tabId, size.cols, size.rows, options)
    resizedTabIds.add(tabId)
  })

  for (const id of tabIds) {
    if (resizedTabIds.has(id)) continue
    if (skipTabId != null && id === skipTabId) continue
    backend.resizeTab(id, cols, rows, options)
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
  /** Tab whose backend resize is owned exclusively by `usePaneSizeReport`. The
   *  cascade still dispatches the global terminal-size update and resizes every
   *  other tab, but the active pane is left to be sized by its measurement —
   *  preventing the open-loop chrome estimate from competing with the closed
   *  measurement loop and tearing the rendered viewport. */
  skipTabId: string | null
}

function runResizeCascade({
  backend,
  cols,
  dispatch,
  layoutTrees,
  resizingRef,
  resizingTimerRef,
  rows,
  skipTabId,
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
      resizeSplitTabs(backend, layoutTrees, stableTabIds, cols, rows, options, skipTabId)
    } else if (skipTabId == null) {
      backend.resizeAll(cols, rows, options)
    } else {
      for (const id of stableTabIds) {
        if (id === skipTabId) continue
        backend.resizeTab(id, cols, rows, options)
      }
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
  // Whether the active tab is part of a split. contentOriginRef must hold the
  // whole terminal-area origin (root.tsx derives splitContentOrigin from it and
  // SplitLayout re-adds each pane's bounds offset). When split, the active
  // pane's measured box is pane-relative, so adopting it as the area origin
  // would double-count the pane offset and push the hardware cursor off along
  // the split axis. Track it so handleMeasure can skip the x/y overwrite.
  const activeIsSplitRef = useRef(false)
  {
    const id = state.activeTabId
    const tree =
      id != null && id !== '' ? getTreeForTab(state.layoutTrees, state.tabGroupMap, id) : null
    activeIsSplitRef.current = tree?.type === 'split'
  }
  // Last size we pushed to the backend per tab, used to dedupe the measurement
  // loop so an unchanged box never re-triggers a resize.
  const measuredRef = useRef(new Map<string, { cols: number; rows: number }>())

  // Drop the dedupe cache when the project changes. attach() re-gates every
  // restored tab's paneReady to false; if a tabId carries the same dimensions
  // across projects, handleMeasure's prev-match would short-circuit and
  // never call resizeTab({confirmedFromMeasurement:true}), leaving the gate
  // closed forever — the new pane then paints a stale buffered snapshot from
  // the old project, which is the 2–3 row offset users see.
  const lastProjectIdRef = useRef(state.currentProjectId)
  if (lastProjectIdRef.current !== state.currentProjectId) {
    lastProjectIdRef.current = state.currentProjectId
    measuredRef.current.clear()
  }

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
      // Only adopt the measured box as the terminal-area origin when the active
      // pane spans the whole area (no split). In a split the box is pane-local;
      // keep the model-derived area origin from the terminalSize memo below so
      // the hardware cursor isn't offset by the pane's bounds (see ref comment).
      if (isActive && !activeIsSplitRef.current) {
        contentOriginRef.current = { cols, rows, x: rect.x, y: rect.y }
      }
      const prev = measuredRef.current.get(tabId)
      if (prev !== undefined && prev.cols === cols && prev.rows === rows) {
        return
      }
      // First measurement for this tab: even if it happens to match the
      // open-loop bootstrap size, we still call resizeTab so the backend
      // gate (snapshot suppression until measurement confirms the pane
      // size) is lifted. confirmedFromMeasurement marks this call as the
      // authoritative size for the rendered viewport.
      measuredRef.current.set(tabId, { cols, rows })
      backend.resizeTab(tabId, cols, rows, { confirmedFromMeasurement: true })
    },
    [backend, contentOriginRef]
  )

  // `getBarWidth` is the single authority on bar width — the Bar component
  // renders from the same function. A mismatch silently corrupts PTY columns
  // and mouse hit-testing.
  const leftBarWidth = getBarWidth(state.bars.left)
  const rightBarWidth = getBarWidth(state.bars.right)
  const terminalSize = useMemo(() => {
    const projectBarRows = state.projectBar.visible ? 1 : 0
    const projectBarTopOffset = projectBarRows
    const reservedRows =
      MAIN_AREA_VERTICAL_PADDING +
      STATUS_BAR_HEIGHT +
      TERMINAL_PANE_VERTICAL_CHROME +
      projectBarRows
    const cols = Math.max(
      MIN_TERMINAL_COLS,
      Math.floor(dimensions.width - leftBarWidth - rightBarWidth - MAIN_AREA_HORIZONTAL_CHROME)
    )
    const rows = Math.max(MIN_TERMINAL_ROWS, Math.floor(dimensions.height - reservedRows))

    contentOriginRef.current = {
      cols,
      rows,
      x: leftBarWidth + 1,
      y: 1 + projectBarTopOffset,
    }

    return { cols, rows }
  }, [
    contentOriginRef,
    dimensions.height,
    dimensions.width,
    leftBarWidth,
    rightBarWidth,
    state.projectBar.visible,
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
      skipTabId: activeTabIdRef.current ?? null,
      stableTabIds,
      sync: true,
    })
    handledBySyncRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftBarWidth, rightBarWidth, state.projectBar.visible])

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
      skipTabId: activeTabIdRef.current ?? null,
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

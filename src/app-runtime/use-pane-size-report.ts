import type { BoxRenderable } from '@opentui/core'

import { useCallback, useEffect, useRef } from 'react'

/** Geometry of the rendered terminal content box, in absolute screen cells. */
export interface MeasuredPaneRect {
  /** 0-based screen column of the first content cell */
  x: number
  /** 0-based screen row of the first content cell */
  y: number
  /** content width in cells == required PTY/xterm cols */
  cols: number
  /** content height in cells == required PTY/xterm rows */
  rows: number
}

// opentui recomputes layout on its own render tick after React commits
// (resetAfterCommit → requestRender). Re-reading the renderable two frames
// later guarantees we observe the settled layout even when the terminal is
// otherwise idle (a sidebar toggle on a static shell would not produce
// another React commit on its own). overflow:hidden on the content box keeps
// the box size independent of terminal content, so this loop provably
// converges and cannot oscillate.
const SETTLE_DELAY_MS = 32

/**
 * Closed measurement loop: observes the *actual* rendered terminal content
 * box and reports its geometry whenever it changes. The reported size is the
 * single source of truth for sizing the PTY + xterm emulator, replacing the
 * open-loop "terminal height minus a hardcoded chrome model" estimate that
 * drifted (status-bar wrap, disconnected/error line, split chrome) and left
 * dead rows / shifted content.
 *
 * Returns a ref callback to attach to the content box renderable.
 */
export function usePaneSizeReport(
  tabId: string | undefined,
  enabled: boolean,
  onMeasure: ((tabId: string, rect: MeasuredPaneRect) => void) | undefined
): (node: BoxRenderable | null) => void {
  const boxRef = useRef<BoxRenderable | null>(null)
  const lastRef = useRef<MeasuredPaneRect | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const measure = useCallback(() => {
    const box = boxRef.current
    if (!box || tabId == null || tabId === '' || !enabled || !onMeasure) {
      return
    }
    const cols = Math.round(box.width)
    const rows = Math.round(box.height)
    const x = Math.round(box.x)
    const y = Math.round(box.y)
    if (cols < 1 || rows < 1) {
      return
    }
    const prev = lastRef.current
    if (prev && prev.cols === cols && prev.rows === rows && prev.x === x && prev.y === y) {
      return
    }
    const next: MeasuredPaneRect = { cols, rows, x, y }
    lastRef.current = next
    onMeasure(tabId, next)
  }, [enabled, onMeasure, tabId])

  // Runs after every commit: measure now (covers the steady-state case where
  // layout was already settled on a prior frame) and once more after
  // opentui's render/layout tick.
  useEffect(() => {
    measure()
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      measure()
    }, SETTLE_DELAY_MS)
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  })

  return useCallback(
    (node: BoxRenderable | null) => {
      boxRef.current = node
      if (node) {
        measure()
      }
    },
    [measure]
  )
}

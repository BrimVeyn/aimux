import type { ScrollBoxRenderable } from '@opentui/core'

import { useEffect } from 'react'

interface Options {
  scrollRef: React.RefObject<ScrollBoxRenderable | null>
  visible: boolean
  /** Id of the active child, without the prefix. Null when there is none. */
  activeId: string | null
  idPrefix: string
}

/**
 * Scroll the active child into view whenever it changes (and on first reveal).
 * A thin wrapper around `scrollChildIntoView` — no wrap-around/edge heuristics,
 * which is all a single-axis list of equal rows needs.
 */
export function useScrollActiveIntoView({ activeId, idPrefix, scrollRef, visible }: Options): void {
  useEffect(() => {
    if (!visible) return
    if (activeId == null || activeId === '') return
    const scrollbox = scrollRef.current
    if (!scrollbox) return
    scrollbox.scrollChildIntoView(`${idPrefix}${activeId}`)
  }, [activeId, idPrefix, scrollRef, visible])
}

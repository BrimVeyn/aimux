import type { ScrollBoxRenderable } from '@opentui/core'

import { useEffect } from 'react'

interface Options {
  scrollRef: React.RefObject<ScrollBoxRenderable | null>
  visible: boolean
  activeTabId: string | null
  idPrefix: string
}

/**
 * Scroll the active tab into view whenever the active tab id changes (and on
 * first reveal). The top bar is a single horizontal row, so this is just a
 * thin wrapper around `scrollChildIntoView` — no wrap-around/edge heuristics.
 */
export function useTopTabBarAutoScroll({
  activeTabId,
  idPrefix,
  scrollRef,
  visible,
}: Options): void {
  useEffect(() => {
    if (!visible) return
    if (activeTabId == null || activeTabId === '') return
    const scrollbox = scrollRef.current
    if (!scrollbox) return
    scrollbox.scrollChildIntoView(`${idPrefix}${activeTabId}`)
  }, [activeTabId, idPrefix, scrollRef, visible])
}

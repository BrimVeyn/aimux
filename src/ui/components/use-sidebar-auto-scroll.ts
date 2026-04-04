import type { ScrollBoxRenderable } from '@opentui/core'

import { useEffect, useRef } from 'react'

import { getSidebarScrollTarget } from './sidebar-scroll'

interface UseSidebarAutoScrollOptions {
  scrollRef: React.RefObject<ScrollBoxRenderable | null>
  visible: boolean
  activeTabId: string | null
  activeIndex: number
  tabCount: number
}

export function useSidebarAutoScroll({
  scrollRef,
  visible,
  activeTabId,
  activeIndex,
  tabCount,
}: UseSidebarAutoScrollOptions): void {
  const previousActiveIndexRef = useRef(-1)
  const previousVisibilityRef = useRef(visible)

  useEffect(() => {
    if (!visible) {
      previousVisibilityRef.current = false
      previousActiveIndexRef.current = activeIndex
      return
    }

    const scrollbox = scrollRef.current
    if (!scrollbox) {
      previousVisibilityRef.current = visible
      previousActiveIndexRef.current = activeIndex
      return
    }

    if (!previousVisibilityRef.current && activeTabId) {
      scrollbox.scrollChildIntoView(`sidebar-tab-${activeTabId}`)
      previousVisibilityRef.current = true
      previousActiveIndexRef.current = activeIndex
      return
    }

    const scrollTarget = getSidebarScrollTarget({
      previousActiveIndex: previousActiveIndexRef.current,
      nextActiveIndex: activeIndex,
      tabCount,
    })

    if (scrollTarget === 'top') {
      scrollbox.scrollTo({ x: 0, y: 0 })
    } else if (scrollTarget === 'bottom') {
      scrollbox.scrollTo({ x: 0, y: scrollbox.scrollHeight })
    } else if (scrollTarget === 'active-item' && activeTabId) {
      scrollbox.scrollChildIntoView(`sidebar-tab-${activeTabId}`)
    }

    previousVisibilityRef.current = visible
    previousActiveIndexRef.current = activeIndex
  }, [activeIndex, activeTabId, scrollRef, tabCount, visible])
}

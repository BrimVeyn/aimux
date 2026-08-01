import type { ScrollBoxRenderable } from '@opentui/core'

import { useEffect } from 'react'

interface Options {
  scrollRef: React.RefObject<ScrollBoxRenderable | null>
  visible: boolean
  /** Full id of the active row to bring into view (project OR workspace). */
  activeRowId: string | null
}

export function useSidebarAutoScroll({ activeRowId, scrollRef, visible }: Options): void {
  useEffect(() => {
    if (!visible) return
    if (activeRowId == null || activeRowId === '') return
    const scrollbox = scrollRef.current
    if (!scrollbox) return
    scrollbox.scrollChildIntoView(activeRowId)
  }, [activeRowId, scrollRef, visible])
}

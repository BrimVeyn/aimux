import type { ScrollBoxRenderable } from '@opentui/core'

import { useEffect } from 'react'

interface Options {
  scrollRef: React.RefObject<ScrollBoxRenderable | null>
  visible: boolean
  activeWorktreeId: string | null | undefined
  idPrefix: string
}

export function useSidebarAutoScroll({
  activeWorktreeId,
  idPrefix,
  scrollRef,
  visible,
}: Options): void {
  useEffect(() => {
    if (!visible) return
    if (activeWorktreeId == null || activeWorktreeId === '') return
    const scrollbox = scrollRef.current
    if (!scrollbox) return
    scrollbox.scrollChildIntoView(`${idPrefix}${activeWorktreeId}`)
  }, [activeWorktreeId, idPrefix, scrollRef, visible])
}

import type { ScrollBoxRenderable } from '@opentui/core'

import { useEffect, useMemo, useRef, useState } from 'react'

import type { DiffSegment } from './build-rows'

interface VirtualizedSegment<T extends DiffSegment> {
  bottomSpacer: number
  topSpacer: number
  totalHeight: number
  visible: T[]
}

interface Options<T extends DiffSegment> {
  estimateHeight: (segment: T) => number
  overscan: number
  scrollRef: React.RefObject<ScrollBoxRenderable | null>
  segments: readonly T[]
  version: number
}

interface ViewportState {
  height: number
  scrollTop: number
}

function sameViewport(a: ViewportState, b: ViewportState): boolean {
  return a.height === b.height && a.scrollTop === b.scrollTop
}

export function useSegmentVirtualization<T extends DiffSegment>({
  estimateHeight,
  overscan,
  scrollRef,
  segments,
  version,
}: Options<T>): VirtualizedSegment<T> {
  const [viewport, setViewport] = useState<ViewportState>({ height: 0, scrollTop: 0 })
  const estimateHeightRef = useRef(estimateHeight)

  useEffect(() => {
    estimateHeightRef.current = estimateHeight
  }, [estimateHeight])

  useEffect(() => {
    let frame = 0
    const tick = (): void => {
      const node = scrollRef.current
      const next = {
        height: Math.max(1, node?.viewport.height ?? 0),
        scrollTop: Math.max(0, node?.scrollTop ?? 0),
      }
      setViewport((prev) => (sameViewport(prev, next) ? prev : next))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [scrollRef])

  return useMemo(() => {
    void version
    if (segments.length === 0) {
      return { bottomSpacer: 0, topSpacer: 0, totalHeight: 0, visible: [] }
    }
    const topTarget = Math.max(0, viewport.scrollTop - overscan)
    const bottomTarget = viewport.scrollTop + viewport.height + overscan
    let totalHeight = 0
    let topSpacer = 0
    let start = 0
    while (start < segments.length) {
      const height = estimateHeightRef.current(segments[start] as T)
      if (totalHeight + height > topTarget) break
      topSpacer += height
      totalHeight += height
      start += 1
    }
    let end = start
    while (end < segments.length && totalHeight < bottomTarget) {
      totalHeight += estimateHeightRef.current(segments[end] as T)
      end += 1
    }
    let bottomSpacer = 0
    for (let i = end; i < segments.length; i++) {
      bottomSpacer += estimateHeightRef.current(segments[i] as T)
    }
    totalHeight = topSpacer + bottomSpacer
    for (let i = start; i < end; i++) totalHeight += estimateHeightRef.current(segments[i] as T)
    return {
      bottomSpacer,
      topSpacer,
      totalHeight,
      visible: segments.slice(start, end) as T[],
    }
  }, [overscan, segments, version, viewport])
}

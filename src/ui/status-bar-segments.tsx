import { type ReactNode, useSyncExternalStore } from 'react'

/**
 * Tiles on the right of the status bar, between the filler and the version.
 *
 * The bar is a lualine-style row of fixed slots — mode, project, filler,
 * version — and until now anything that wanted a place in it had to be written
 * into `status-bar.tsx` by hand. The AI-usage indicator was the only such
 * thing, and turning it into a plugin is what made the absence of a registry a
 * problem rather than a style preference.
 *
 * Order is registration order, and the bar draws its own separators around each
 * tile: a segment renders content, not chrome, so it cannot get the powerline
 * glyphs or the tile colours wrong.
 */

export interface StatusBarSegmentDefinition {
  /** Qualified id, `<pluginId>.<segmentId>`. The kernel namespaces it. */
  id: string
  render: () => ReactNode
}

const segments = new Map<string, StatusBarSegmentDefinition>()
const listeners = new Set<() => void>()

/** Recomputed on change so `useSyncExternalStore` sees a stable snapshot. */
let snapshot: readonly StatusBarSegmentDefinition[] = []

function notify(): void {
  snapshot = [...segments.values()]
  for (const listener of new Set(listeners)) listener()
}

export function registerStatusBarSegment(segment: StatusBarSegmentDefinition): () => void {
  segments.set(segment.id, segment)
  notify()
  return () => {
    if (segments.get(segment.id) === segment) {
      segments.delete(segment.id)
      notify()
    }
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The tiles to draw, in registration order. */
export function useStatusBarSegments(): readonly StatusBarSegmentDefinition[] {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot
  )
}

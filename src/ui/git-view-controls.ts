import { createContext, useContext } from 'react'

type Scroller = (delta: number) => void

/**
 * Where a diff's scroll keys and wheel go. One per screen that draws diffs: git
 * mode has its own, and a plugin's file view brings another, so the wheel over
 * one never scrolls the other.
 */
export interface DiffScrollSlot {
  /** The scroller of whatever is drawn now. */
  set: (scroller: Scroller | null) => void
  /**
   * Hands the scroll to a view that is not a text diff (a PDF pages through it
   * instead) for as long as it is mounted. The returned function gives it back
   * to whoever held it before.
   */
  override: (scroller: Scroller) => () => void
  scroll: (delta: number) => void
}

export function createDiffScrollSlot(): DiffScrollSlot {
  let active: Scroller | null = null
  return {
    override: (scroller) => {
      const previous = active
      active = scroller
      return () => {
        if (active === scroller) active = previous
      }
    },
    scroll: (delta) => active?.(delta),
    set: (scroller) => {
      active = scroller
    },
  }
}

const gitSlot = createDiffScrollSlot()

/** The slot the views below a provider scroll through. Git mode's by default. */
export const DiffScrollContext = createContext<DiffScrollSlot>(gitSlot)

export function useDiffScroll(): DiffScrollSlot {
  return useContext(DiffScrollContext)
}

export function setGitDiffScroller(scroller: Scroller | null): void {
  gitSlot.set(scroller)
}

export function scrollGitDiff(delta: number): void {
  gitSlot.scroll(delta)
}

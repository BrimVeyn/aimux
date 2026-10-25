import { createContext, useContext } from 'react'

type Scroller = (delta: number) => void

/** What a text diff offers to keys that act on its changes rather than its rows. */
export interface HunkNavigator {
  /** Scroll to the next (1) or previous (-1) change block. */
  jump: (delta: 1 | -1) => void
  /** The change block at the top of the view, ready to paste; null when there is none. */
  current: () => string | null
}

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
  /** The text diff drawn now takes the hunk keys until the returned function is called. */
  provideHunks: (navigator: HunkNavigator) => () => void
  jumpHunk: (delta: 1 | -1) => void
  currentHunk: () => string | null
}

export function createDiffScrollSlot(): DiffScrollSlot {
  let active: Scroller | null = null
  let hunks: HunkNavigator | null = null
  return {
    currentHunk: () => hunks?.current() ?? null,
    jumpHunk: (delta) => hunks?.jump(delta),
    override: (scroller) => {
      const previous = active
      active = scroller
      return () => {
        if (active === scroller) active = previous
      }
    },
    provideHunks: (navigator) => {
      hunks = navigator
      return () => {
        if (hunks === navigator) hunks = null
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

export function jumpGitHunk(delta: 1 | -1): void {
  gitSlot.jumpHunk(delta)
}

export function currentGitHunk(): string | null {
  return gitSlot.currentHunk()
}

type Scroller = (delta: number) => void

let activeScroller: Scroller | null = null

export function setGitDiffScroller(scroller: Scroller | null): void {
  activeScroller = scroller
}

/**
 * Hands the diff scroll keys to a view that is not a text diff (a PDF pages
 * through them instead) for as long as it is mounted. The returned function
 * gives them back to whoever held them before.
 */
export function overrideGitDiffScroller(scroller: Scroller): () => void {
  const previous = activeScroller
  activeScroller = scroller
  return () => {
    if (activeScroller === scroller) activeScroller = previous
  }
}

export function scrollGitDiff(delta: number): void {
  activeScroller?.(delta)
}

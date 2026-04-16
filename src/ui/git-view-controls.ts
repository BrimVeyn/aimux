type Scroller = (delta: number) => void

let activeScroller: Scroller | null = null

export function setGitDiffScroller(scroller: Scroller | null): void {
  activeScroller = scroller
}

export function scrollGitDiff(delta: number): void {
  activeScroller?.(delta)
}

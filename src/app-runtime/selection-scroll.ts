interface SelectableLike {
  selectable?: boolean
  isDestroyed?: boolean
}

function isUsableTarget(target: SelectableLike | null | undefined): target is SelectableLike {
  return Boolean(target?.selectable) && !(target?.isDestroyed === true)
}

interface SelectionLike {
  isActive: boolean
  isDragging: boolean
  anchor: { x: number; y: number }
  focus: { x: number; y: number }
  selectedRenderables: SelectableLike[]
  touchedRenderables: SelectableLike[]
}

export interface RendererSelectionApi {
  getSelection(): SelectionLike | null
  startSelection(target: unknown, x: number, y: number): void
  updateSelection(target: unknown, x: number, y: number, opts: { finishDragging: boolean }): void
  clearSelection(): void
}

interface ShiftState {
  target: SelectableLike | null
  anchor: { x: number; y: number } | null
  focus: { x: number; y: number } | null
}

const states = new WeakMap<object, ShiftState>()

function getState(renderer: object): ShiftState {
  let s = states.get(renderer)
  if (!s) {
    s = { anchor: null, focus: null, target: null }
    states.set(renderer, s)
  }
  return s
}

export function resetSelectionShiftState(renderer: object): void {
  states.set(renderer, { anchor: null, focus: null, target: null })
}

function pickSelectionTarget(selection: SelectionLike): SelectableLike | null {
  for (const r of selection.selectedRenderables) {
    if (isUsableTarget(r)) return r
  }
  for (const r of selection.touchedRenderables) {
    if (isUsableTarget(r)) return r
  }
  return null
}

function liveDiffersFromCache(live: SelectionLike, state: ShiftState): boolean {
  if (!state.anchor || !state.focus) return true
  return (
    live.anchor.x !== state.anchor.x ||
    live.anchor.y !== state.anchor.y ||
    live.focus.x !== state.focus.x ||
    live.focus.y !== state.focus.y
  )
}

export function shiftSelectionByScroll(renderer: RendererSelectionApi, deltaLines: number): void {
  if (deltaLines === 0) return

  const live = renderer.getSelection()

  if (!(live?.isActive === true)) {
    resetSelectionShiftState(renderer)
    return
  }

  if (live.isDragging) {
    // Mid-drag (e.g. user holds the mouse and scrolls past the viewport edge to
    // extend the selection): only the anchor needs to follow the content. The
    // focus is owned by opentui's live pointer tracking, which keeps it pinned
    // to the cursor in screen-space — leave it alone.
    const target = pickSelectionTarget(live)
    if (!isUsableTarget(target)) return
    const anchorY = live.anchor.y - deltaLines
    renderer.startSelection(target, live.anchor.x, anchorY)
    renderer.updateSelection(target, live.focus.x, live.focus.y, { finishDragging: false })
    resetSelectionShiftState(renderer)
    return
  }

  const state = getState(renderer)

  if (liveDiffersFromCache(live, state)) {
    const target = pickSelectionTarget(live) ?? (isUsableTarget(state.target) ? state.target : null)
    if (target) {
      state.target = target
      state.anchor = { x: live.anchor.x, y: live.anchor.y }
      state.focus = { x: live.focus.x, y: live.focus.y }
    }
  }

  if (!isUsableTarget(state.target) || !state.anchor || !state.focus) {
    if (!isUsableTarget(state.target)) {
      resetSelectionShiftState(renderer)
    }
    return
  }

  const anchor = { x: state.anchor.x, y: state.anchor.y - deltaLines }
  const focus = { x: state.focus.x, y: state.focus.y - deltaLines }
  state.anchor = anchor
  state.focus = focus

  renderer.startSelection(state.target, anchor.x, anchor.y)
  renderer.updateSelection(state.target, focus.x, focus.y, { finishDragging: true })
}

export interface ViewportObservation {
  tabId: string
  y: number
}

export function applyViewportObservation(
  renderer: RendererSelectionApi,
  prior: ViewportObservation | null,
  next: ViewportObservation | null
): ViewportObservation | null {
  if (!next) {
    if (prior !== null) {
      renderer.clearSelection()
      resetSelectionShiftState(renderer)
    }
    return null
  }

  if (!prior || prior.tabId !== next.tabId) {
    if (prior && prior.tabId !== next.tabId) renderer.clearSelection()
    resetSelectionShiftState(renderer)
    return next
  }

  const delta = next.y - prior.y
  if (delta !== 0) {
    shiftSelectionByScroll(renderer, delta)
  }
  return next
}

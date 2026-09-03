import type { AppAction } from '../actions'
import type { AppState, BarSide, BarState, BarWidget } from '../types'

import {
  boundaryDeltaFromRatio,
  clampBarWidth,
  DEFAULT_WIDGET_GROW,
  findWidgetBar,
  shiftBoundary,
  visibleWidgets,
} from '../bars'

/** The same widget without the plugin's placement mark. */
function unmark(widget: BarWidget): BarWidget {
  if (widget.placedBy === undefined) return widget
  const { placedBy: _placedBy, ...rest } = widget
  return rest
}

/** Widgets are stored with `grow > 0`; anything else would break the maths. */
function clampGrow(grow: number | undefined): number {
  if (grow === undefined || !Number.isFinite(grow)) return DEFAULT_WIDGET_GROW
  return Math.max(1, Math.round(grow))
}

function withBar(state: AppState, side: BarSide, next: BarState): AppState {
  if (next === state.bars[side]) return state
  return { ...state, bars: { ...state.bars, [side]: next } }
}

function setBarWidth(state: AppState, side: BarSide, width: number): AppState {
  const bar = state.bars[side]
  const next = clampBarWidth(width)
  if (next === bar.width) return state
  return withBar(state, side, { ...bar, width: next })
}

/**
 * Move `widgetId` to `side` at `index`. Covers both cross-bar moves and
 * in-bar reordering — removing then re-inserting is the same operation.
 */
function moveWidget(state: AppState, widgetId: string, side: BarSide, index: number): AppState {
  const from = findWidgetBar(state.bars, widgetId)
  if (from === null) return state
  const widget = state.bars[from].widgets.find((w) => w.id === widgetId)
  if (!widget) return state

  const source = state.bars[from].widgets.filter((w) => w.id !== widgetId)
  const target: BarWidget[] = from === side ? source : [...state.bars[side].widgets]
  const at = Math.max(0, Math.min(target.length, index))
  // The user chose where it goes, so it is no longer the plugin's placement to
  // withdraw on unload.
  target.splice(at, 0, unmark(widget))

  const bars = { ...state.bars }
  bars[from] = { ...state.bars[from], widgets: from === side ? target : source }
  // Showing a widget in a hidden bar would silently swallow it.
  bars[side] = { ...bars[side], visible: bars[side].visible || widget.visible, widgets: target }
  return { ...state, bars }
}

export function reduceUIState(state: AppState, action: AppAction): AppState | null {
  switch (action.type) {
    case 'toggle-bar': {
      const bar = state.bars[action.side]
      return withBar(state, action.side, { ...bar, visible: !bar.visible })
    }
    case 'resize-bar':
      return setBarWidth(state, action.side, state.bars[action.side].width + action.delta)
    case 'set-bar-width':
      return setBarWidth(state, action.side, action.width)
    case 'toggle-widget': {
      const side = findWidgetBar(state.bars, action.widgetId)
      if (side === null) return state
      const bar = state.bars[side]
      // Showing or hiding it is a decision too — same reason `move-widget`
      // drops the mark.
      const widgets = bar.widgets.map((w) =>
        w.id === action.widgetId ? unmark({ ...w, visible: !w.visible }) : w
      )
      const revealed = widgets.some((w) => w.id === action.widgetId && w.visible)
      return withBar(state, side, { ...bar, visible: bar.visible || revealed, widgets })
    }
    case 'add-widget': {
      // Idempotent, and deliberately so: a plugin re-applies its manifest on
      // every reload, and a second copy of one widget — or a placement that
      // overrode where the user had since dragged it — is what that would
      // otherwise mean.
      if (findWidgetBar(state.bars, action.widgetId) !== null) return state
      const bar = state.bars[action.side]
      const widget: BarWidget = {
        grow: clampGrow(action.grow),
        id: action.widgetId,
        visible: true,
        ...(action.placedBy === undefined ? {} : { placedBy: action.placedBy }),
      }
      const at = Math.max(0, Math.min(bar.widgets.length, action.index ?? bar.widgets.length))
      const widgets = [...bar.widgets]
      widgets.splice(at, 0, widget)
      // A widget placed in a closed bar is a widget nobody sees; `move-widget`
      // opens the bar for the same reason.
      return withBar(state, action.side, { ...bar, visible: true, widgets })
    }
    case 'remove-plugin-widget': {
      const side = findWidgetBar(state.bars, action.widgetId)
      if (side === null) return state
      const bar = state.bars[side]
      // Only what the plugin put there, and only while the user has left it
      // alone. Anything else is the user's arrangement, and an unload has no
      // business editing it.
      if (bar.widgets.find((w) => w.id === action.widgetId)?.placedBy !== 'plugin') return state
      const widgets = bar.widgets.filter((w) => w.id !== action.widgetId)
      return withBar(state, side, { ...bar, widgets })
    }
    case 'move-widget':
      return moveWidget(state, action.widgetId, action.side, action.index)
    case 'set-bar-boundary': {
      const bar = state.bars[action.side]
      const delta = boundaryDeltaFromRatio(bar, action.index, action.ratio)
      const widgets = shiftBoundary(bar, action.index, delta)
      if (widgets === bar.widgets) return state
      return withBar(state, action.side, { ...bar, widgets })
    }
    case 'resize-widget': {
      // Keyboard resize: grow/shrink this widget against its neighbour. The
      // widget below owns the boundary above it, so the sign flips there.
      const side = findWidgetBar(state.bars, action.widgetId)
      if (side === null) return state
      const bar = state.bars[side]
      const visible = visibleWidgets(bar)
      const at = visible.findIndex((w) => w.id === action.widgetId)
      if (at === -1) return state
      const total = visible.reduce((sum, w) => sum + w.grow, 0)
      const index = at > 0 ? at - 1 : at
      const deltaGrow = action.delta * total * (at > 0 ? -1 : 1)
      const widgets = shiftBoundary(bar, index, deltaGrow)
      if (widgets === bar.widgets) return state
      return withBar(state, side, { ...bar, widgets })
    }
    case 'set-focus-mode':
      return { ...state, focusMode: action.focusMode }
    case 'set-terminal-size':
      return { ...state, layout: { terminalCols: action.cols, terminalRows: action.rows } }
    case 'set-pending-chords':
      if (
        state.pendingChords === action.chords ||
        (state.pendingChords === null && action.chords === null)
      ) {
        return state
      }
      return { ...state, pendingChords: action.chords }
    case 'toggle-project-bar':
      return {
        ...state,
        projectBar: { ...state.projectBar, visible: !state.projectBar.visible },
      }
    default:
      return null
  }
}

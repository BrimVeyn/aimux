import type { BarSide, BarsState, BarState, BarWidget } from './types'

export const BAR_MIN_WIDTH = 18
export const BAR_MAX_WIDTH = 80

/** Widget ids the app knows how to render. Unknown ids are pruned on load. */
export const KNOWN_WIDGET_IDS = ['projects', 'git', 'setup'] as const

/** Smallest share of a bar a single widget may shrink to, as a fraction. */
const MIN_WIDGET_SHARE = 0.1

export function clampBarWidth(width: number): number {
  return Math.min(BAR_MAX_WIDTH, Math.max(BAR_MIN_WIDTH, Math.round(width)))
}

export function visibleWidgets(bar: BarState): BarWidget[] {
  return bar.widgets.filter((widget) => widget.visible)
}

/**
 * The single authority on how many columns a bar occupies. Both the `Bar`
 * component and the terminal-size computation must call this — a mismatch
 * silently corrupts PTY columns and mouse hit-testing.
 */
export function getBarWidth(bar: BarState): number {
  if (!bar.visible || visibleWidgets(bar).length === 0) return 0
  return clampBarWidth(bar.width)
}

export function findWidgetBar(bars: BarsState, widgetId: string): BarSide | null {
  if (bars.left.widgets.some((widget) => widget.id === widgetId)) return 'left'
  if (bars.right.widgets.some((widget) => widget.id === widgetId)) return 'right'
  return null
}

function totalGrow(widgets: BarWidget[]): number {
  return widgets.reduce((sum, widget) => sum + widget.grow, 0)
}

/**
 * Move the boundary between visible widgets `index` and `index + 1` by
 * `deltaGrow`. Only the pair changes, so the bar's total grow is preserved and
 * no renormalisation is ever needed — including when a widget is added.
 */
export function shiftBoundary(bar: BarState, index: number, deltaGrow: number): BarWidget[] {
  const visible = visibleWidgets(bar)
  const above = visible[index]
  const below = visible[index + 1]
  if (!above || !below) return bar.widgets

  const min = Math.max(1, Math.round(totalGrow(visible) * MIN_WIDGET_SHARE))
  const pair = above.grow + below.grow
  if (pair < min * 2) return bar.widgets

  const nextAbove = Math.min(pair - min, Math.max(min, Math.round(above.grow + deltaGrow)))
  if (nextAbove === above.grow) return bar.widgets

  return bar.widgets.map((widget) => {
    if (widget.id === above.id) return { ...widget, grow: nextAbove }
    if (widget.id === below.id) return { ...widget, grow: pair - nextAbove }
    return widget
  })
}

/**
 * Convert an absolute drag position (a 0..1 fraction of the bar's body) into
 * the grow delta `shiftBoundary` expects for that boundary.
 */
export function boundaryDeltaFromRatio(bar: BarState, index: number, ratio: number): number {
  const visible = visibleWidgets(bar)
  const target = visible[index]
  if (!target) return 0
  const above = visible.slice(0, index).reduce((sum, widget) => sum + widget.grow, 0)
  return ratio * totalGrow(visible) - above - target.grow
}

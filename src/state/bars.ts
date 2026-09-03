import type { BarSide, BarsState, BarState, BarWidget } from './types'

export const BAR_MIN_WIDTH = 18
export const BAR_MAX_WIDTH = 80

/** Widget ids aimux ships. */
export const BUILTIN_WIDGET_IDS = ['projects', 'git', 'setup'] as const

/**
 * Widget ids a plugin has registered a renderer for. Kept here rather than in
 * the UI registry so `visibleWidgets` — which the resize maths and the
 * terminal-size computation both call — can ask "is this drawable?" without
 * the state layer importing React.
 */
const pluginWidgetIds = new Set<string>()

/**
 * Registers a plugin widget id as renderable. Returns the disposer the
 * plugin's fiber holds; `src/ui/widgets/registry.tsx` calls this alongside
 * registering the renderer itself.
 */
export function registerWidgetId(id: string): () => void {
  pluginWidgetIds.add(id)
  return () => {
    pluginWidgetIds.delete(id)
  }
}

/** Test seam. Never called by the app. */
export function clearPluginWidgetIds(): void {
  pluginWidgetIds.clear()
}

export function getKnownWidgetIds(): string[] {
  return [...BUILTIN_WIDGET_IDS, ...pluginWidgetIds]
}

/**
 * Whether anything can draw this id right now. A persisted id whose plugin is
 * disabled, still loading, or failed answers false — it is an *orphan*, not
 * corruption, and the difference matters: pruning it would delete the user's
 * placement and re-save the deletion, so re-enabling the plugin would put the
 * widget back in the wrong bar, or nowhere.
 */
export function isWidgetRenderable(id: string): boolean {
  return (BUILTIN_WIDGET_IDS as readonly string[]).includes(id) || pluginWidgetIds.has(id)
}

/**
 * The share a widget gets when nothing asked for one. Every shipped widget was
 * persisted at 50, so a new arrival lands beside them as an equal rather than
 * squeezing them.
 */
export const DEFAULT_WIDGET_GROW = 50

/** Smallest share of a bar a single widget may shrink to, as a fraction. */
const MIN_WIDGET_SHARE = 0.1

export function clampBarWidth(width: number): number {
  return Math.min(BAR_MAX_WIDTH, Math.max(BAR_MIN_WIDTH, Math.round(width)))
}

/**
 * The widgets a bar actually draws: marked visible *and* renderable. An
 * orphan is skipped rather than shown empty, and skipped everywhere at once —
 * the layout maths, the bar width, and the resize handles all read this.
 */
export function visibleWidgets(bar: BarState): BarWidget[] {
  return bar.widgets.filter((widget) => widget.visible && isWidgetRenderable(widget.id))
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

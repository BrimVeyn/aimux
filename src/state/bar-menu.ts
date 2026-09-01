import type { BarSide } from './types'

/**
 * The little of a bar these builders read. Generic so the GUI renderer can
 * build the same menu from its wire-level `bars`, which carries the widget ids
 * and their visibility but not the renderers.
 */
export interface BarsShape {
  left: { widgets: { id: string; visible: boolean }[] }
  right: { widgets: { id: string; visible: boolean }[] }
}

/**
 * The bar and widget context menus, as descriptors rather than closures. Both
 * front-ends need the same items, in the same order, behind the same guards —
 * and only one of them can call `dispatchGlobal`. The TUI wraps each action in
 * a dispatch; the GUI sends it over the wire.
 */
export type BarMenuAction =
  | { type: 'move-widget'; widgetId: string; side: BarSide; index: number }
  | { type: 'toggle-widget'; widgetId: string }
  | { type: 'toggle-bar'; side: BarSide }

export interface BarMenuItem {
  label: string
  action: BarMenuAction
}

/** Everything a bar can host. Labels only — the renderers are per-front-end. */
export const WIDGET_LABELS: Record<string, string> = {
  git: 'Git',
  projects: 'Projects',
  setup: 'Setup',
}

/** `Show <label>` for every hidden widget in either bar. */
function showHiddenItems(bars: BarsShape): BarMenuItem[] {
  const items: BarMenuItem[] = []
  for (const side of ['left', 'right'] as const) {
    for (const widget of bars[side].widgets) {
      if (widget.visible) continue
      items.push({
        action: { type: 'toggle-widget', widgetId: widget.id },
        label: `Show ${WIDGET_LABELS[widget.id] ?? widget.id}`,
      })
    }
  }
  return items
}

/**
 * Right-click menu for a widget hosted in a bar: move it across, reorder it
 * within its bar, hide it, or bring back one that is hidden. Generic — a new
 * widget gets this for free.
 *
 * The unhide entries live here and not only on the bar's own menu because the
 * bar's menu is unreachable: widget slots cover the whole body and stop
 * right-click propagation, and the edge and boundary handles swallow every
 * button. Without this, hiding a widget is a one-way door for a mouse user.
 */
export function buildWidgetContextMenu(
  bars: BarsShape,
  side: BarSide,
  widgetId: string
): BarMenuItem[] {
  const widgets = bars[side].widgets
  const index = widgets.findIndex((widget) => widget.id === widgetId)
  if (index === -1) return []

  const other: BarSide = side === 'left' ? 'right' : 'left'
  const items: BarMenuItem[] = [
    {
      action: { index: bars[other].widgets.length, side: other, type: 'move-widget', widgetId },
      label: `Move to ${other} bar`,
    },
  ]

  if (index > 0) {
    items.push({
      action: { index: index - 1, side, type: 'move-widget', widgetId },
      label: 'Move up',
    })
  }
  if (index < widgets.length - 1) {
    items.push({
      action: { index: index + 1, side, type: 'move-widget', widgetId },
      label: 'Move down',
    })
  }

  // Hiding the last visible widget would collapse the bar to zero width and
  // take its own context menu with it — leaving no way back.
  if (bars[side].widgets.filter((widget) => widget.visible).length > 1) {
    items.push({ action: { type: 'toggle-widget', widgetId }, label: 'Hide' })
  }

  items.push(...showHiddenItems(bars))
  return items
}

/** Menu for the bar itself. Offers a way back for every hidden widget. */
export function buildBarContextMenu(bars: BarsShape, side: BarSide): BarMenuItem[] {
  return [
    { action: { side, type: 'toggle-bar' }, label: `Hide ${side} bar` },
    ...showHiddenItems(bars),
  ]
}

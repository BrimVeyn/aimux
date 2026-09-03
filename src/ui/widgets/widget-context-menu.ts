import type { BarSide, BarsState } from '../../state/types'
import type { ContextMenuItem } from '../context-menu/controller'

import { getKnownWidgetIds, visibleWidgets } from '../../state/bars'
import { dispatchGlobal } from '../../state/dispatch-ref'
import { getWidgetLabel, isWidgetRenderable } from './registry'

/**
 * `Add <label>` for every widget something can draw that is in neither bar.
 *
 * Until this existed a widget nothing had placed was unreachable: the menu
 * offered `Show` only for widgets already sitting in a bar, so a plugin's
 * widget could be loaded, renderable and listed — and impossible to put
 * anywhere without hand-editing `aimux.json`.
 */
function addableItems(bars: BarsState, side: BarSide): ContextMenuItem[] {
  const placed = new Set([...bars.left.widgets, ...bars.right.widgets].map((w) => w.id))
  return getKnownWidgetIds()
    .filter((id) => !placed.has(id))
    .map((id) => [
      `Add ${getWidgetLabel(id)}`,
      () => dispatchGlobal({ side, type: 'add-widget', widgetId: id }),
    ])
}

/** `Show <label>` for every hidden widget in either bar. */
function showHiddenItems(bars: BarsState): ContextMenuItem[] {
  const items: ContextMenuItem[] = []
  for (const side of ['left', 'right'] as const) {
    for (const widget of bars[side].widgets) {
      if (widget.visible) continue
      // An orphan — a disabled or failed plugin's widget — is not offerable:
      // showing it would reserve space for something nothing can draw.
      if (!isWidgetRenderable(widget.id)) continue
      items.push([
        `Show ${getWidgetLabel(widget.id)}`,
        () => dispatchGlobal({ type: 'toggle-widget', widgetId: widget.id }),
      ])
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
  bars: BarsState,
  side: BarSide,
  widgetId: string
): ContextMenuItem[] {
  const widgets = bars[side].widgets
  const index = widgets.findIndex((widget) => widget.id === widgetId)
  if (index === -1) return []

  const other: BarSide = side === 'left' ? 'right' : 'left'
  const items: ContextMenuItem[] = [
    [
      `Move to ${other} bar`,
      () =>
        dispatchGlobal({
          index: bars[other].widgets.length,
          side: other,
          type: 'move-widget',
          widgetId,
        }),
    ],
  ]

  if (index > 0) {
    items.push([
      'Move up',
      () => dispatchGlobal({ index: index - 1, side, type: 'move-widget', widgetId }),
    ])
  }
  if (index < widgets.length - 1) {
    items.push([
      'Move down',
      () => dispatchGlobal({ index: index + 1, side, type: 'move-widget', widgetId }),
    ])
  }

  // Hiding the last visible widget would collapse the bar to zero width and
  // take its own context menu with it — leaving no way back.
  if (visibleWidgets(bars[side]).length > 1) {
    items.push(['Hide', () => dispatchGlobal({ type: 'toggle-widget', widgetId })])
  }

  items.push(...showHiddenItems(bars))
  items.push(...addableItems(bars, side))
  return items
}

/** Menu for the bar itself. Offers a way back for every hidden widget. */
export function buildBarContextMenu(bars: BarsState, side: BarSide): ContextMenuItem[] {
  return [
    [`Hide ${side} bar`, () => dispatchGlobal({ side, type: 'toggle-bar' })],
    ...showHiddenItems(bars),
    ...addableItems(bars, side),
  ]
}

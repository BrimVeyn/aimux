import type { BarSide, BarsState } from '../../state/types'
import type { ContextMenuItem } from '../context-menu/controller'

import { visibleWidgets } from '../../state/bars'
import { dispatchGlobal } from '../../state/dispatch-ref'
import { WIDGET_LABELS } from './registry'

/**
 * Right-click menu for a widget hosted in a bar: move it across, reorder it
 * within its bar, or hide it. Generic — a new widget gets this for free.
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
  return items
}

/** Menu for the bar itself. Offers a way back for every hidden widget. */
export function buildBarContextMenu(bars: BarsState, side: BarSide): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    [`Hide ${side} bar`, () => dispatchGlobal({ side, type: 'toggle-bar' })],
  ]
  for (const widget of bars[side].widgets) {
    if (widget.visible) continue
    items.push([
      `Show ${WIDGET_LABELS[widget.id] ?? widget.id}`,
      () => dispatchGlobal({ type: 'toggle-widget', widgetId: widget.id }),
    ])
  }
  return items
}

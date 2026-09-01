import type { BarSide, BarsState } from '../../state/types'
import type { ContextMenuItem } from '../context-menu/controller'

import {
  buildBarContextMenu as barItems,
  buildWidgetContextMenu as widgetItems,
} from '../../state/bar-menu'
import { dispatchGlobal } from '../../state/dispatch-ref'

/** The shared descriptors, bound to this front-end's dispatch. */
function toMenu(items: ReturnType<typeof barItems>): ContextMenuItem[] {
  return items.map(({ action, label }) => [label, () => dispatchGlobal(action)])
}

export function buildWidgetContextMenu(
  bars: BarsState,
  side: BarSide,
  widgetId: string
): ContextMenuItem[] {
  return toMenu(widgetItems(bars, side, widgetId))
}

export function buildBarContextMenu(bars: BarsState, side: BarSide): ContextMenuItem[] {
  return toMenu(barItems(bars, side))
}

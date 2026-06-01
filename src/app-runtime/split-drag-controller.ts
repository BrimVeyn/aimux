import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'

import type { SplitDirection } from '../state/layout-tree'

type ScreenAxis = 'x' | 'y'

export interface SplitDragState {
  tabId: string
  direction: SplitDirection
  screenStart: number
  totalSize: number
}

export interface AxisDragState {
  axis: ScreenAxis
  screenStart: number
}

export interface AnchoredRatioDragState {
  anchor: 'start' | 'end'
  axis: ScreenAxis
  screenStart: number
  totalSize: number
}

function getScreenPosition(event: OtuiMouseEvent, axis: ScreenAxis): number {
  return axis === 'x' ? event.x : event.y
}

export function getSplitRatioFromDrag(event: OtuiMouseEvent, drag: SplitDragState): number {
  const position = getScreenPosition(event, drag.direction === 'vertical' ? 'x' : 'y')
  const total = Math.max(1, drag.totalSize)
  const cells = Math.round(position - drag.screenStart)
  return cells / total
}

export function getAxisDeltaFromDrag(event: OtuiMouseEvent, drag: AxisDragState): number {
  return getScreenPosition(event, drag.axis) - drag.screenStart
}

export function getAnchoredRatioFromDrag(
  event: OtuiMouseEvent,
  drag: AnchoredRatioDragState
): number {
  const offset = getScreenPosition(event, drag.axis) - drag.screenStart
  return drag.anchor === 'start' ? offset / drag.totalSize : 1 - offset / drag.totalSize
}

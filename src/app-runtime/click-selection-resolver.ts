import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'

import type { TabSession } from '../state/types'

import { logInputDebug } from '../debug/input-log'
import { getLineText, getWordAtColumn } from '../input/terminal-text-extraction'

interface PositionedNode {
  id?: string
  parent?: unknown
  selectable?: boolean
  x: number
  y: number
}

export type MultiClickMode = 'word' | 'line'

export interface ClickSelectionResult {
  selectedText: string
  startCol: number
  endCol: number
  baseX: number
  eventY: number
  target: unknown
  row: number
  mode: MultiClickMode
}

export interface ViewportAnchor {
  target: PositionedNode
  baseX: number
  baseY: number
  col: number
  row: number
}

export interface MultiClickRange {
  startCol: number
  endCol: number
  lineLength: number
}

export function isPositionedNode(value: unknown): value is PositionedNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'x') === 'number' &&
    typeof Reflect.get(value, 'y') === 'number'
  )
}

export function getViewportAnchor(event: OtuiMouseEvent): ViewportAnchor | null {
  if (!event.target || !isPositionedNode(event.target)) return null
  const baseX = event.target.x
  const baseY = event.target.y
  return {
    baseX,
    baseY,
    col: event.x - baseX,
    row: event.y - baseY,
    target: event.target,
  }
}

export function computeRangeFromLineText(
  lineText: string,
  col: number,
  mode: MultiClickMode
): MultiClickRange | null {
  if (mode === 'line') {
    return { endCol: lineText.length, lineLength: lineText.length, startCol: 0 }
  }
  const word = getWordAtColumn(lineText, col)
  if (word.text.length === 0) return null
  return { endCol: word.endCol, lineLength: lineText.length, startCol: word.startCol }
}

export function computeMultiClickRange(
  tab: TabSession | undefined,
  row: number,
  col: number,
  mode: MultiClickMode
): MultiClickRange | null {
  const line = tab?.viewport?.lines[row]
  if (!line) return null
  return computeRangeFromLineText(getLineText(line), col, mode)
}

export function resolveClickSelection(
  event: OtuiMouseEvent,
  targetTabId: string,
  tab: TabSession | undefined,
  clickCount: number
): ClickSelectionResult | null {
  const anchor = getViewportAnchor(event)
  if (!anchor) return null

  const mode: MultiClickMode = clickCount === 2 ? 'word' : 'line'

  logInputDebug('click.detect', {
    clickCount,
    col: anchor.col,
    eventX: event.x,
    eventY: event.y,
    row: anchor.row,
    targetId: anchor.target.id,
    viewportX: anchor.baseX,
    viewportY: anchor.baseY,
  })

  if (!tab?.viewport?.lines[anchor.row]) {
    logInputDebug('click.noViewportLine', {
      hasViewport: !!tab?.viewport,
      lineCount: tab?.viewport?.lines.length ?? 0,
      row: anchor.row,
      tabFound: !!tab,
      targetTabId,
    })
    return null
  }

  const range = computeMultiClickRange(tab, anchor.row, anchor.col, mode)
  if (!range) {
    if (mode === 'word') {
      const line = tab.viewport.lines[anchor.row]
      const lineText = line ? getLineText(line) : ''
      logInputDebug('click.emptyWord', {
        charAtCol: lineText[anchor.col] ?? 'OOB',
        col: anchor.col,
        lineText,
        row: anchor.row,
      })
    }
    return null
  }

  const line = tab.viewport.lines[anchor.row]
  const lineText = line ? getLineText(line) : ''
  const selectedText = lineText.slice(range.startCol, range.endCol)

  logInputDebug('click.selection', {
    baseX: anchor.baseX,
    clickCount,
    endCol: range.endCol,
    endX: anchor.baseX + range.endCol,
    lineText,
    mode,
    selectedText,
    startCol: range.startCol,
    startX: anchor.baseX + range.startCol,
    y: event.y,
  })

  return {
    baseX: anchor.baseX,
    endCol: range.endCol,
    eventY: event.y,
    mode,
    row: anchor.row,
    selectedText,
    startCol: range.startCol,
    target: anchor.target,
  }
}

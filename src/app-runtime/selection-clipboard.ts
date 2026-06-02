import type { TabSession, TerminalLine } from '../state/types'

import { extractStreamText } from '../input/terminal-text-extraction'

interface PositionedNode {
  parent?: unknown
  x: number
  y: number
}

export interface OtuiSelection {
  isDragging?: boolean
  anchor: { x: number; y: number }
  focus: { x: number; y: number }
  touchedRenderables?: unknown[]
  getSelectedText(): string
}

function isPositionedNode(value: unknown): value is PositionedNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'x') === 'number' &&
    typeof Reflect.get(value, 'y') === 'number'
  )
}

export function computeStreamSelectedText(
  selection: OtuiSelection,
  lines: readonly { spans: { text: string }[] }[]
): string | null {
  const touched = selection.touchedRenderables
  if (!touched || touched.length === 0) return null

  const viewportText = touched[0]
  if (!isPositionedNode(viewportText)) return null

  const originX = viewportText.x
  const originY = viewportText.y

  const anchorRow = selection.anchor.y - originY
  const anchorCol = selection.anchor.x - originX
  const focusRow = selection.focus.y - originY
  const focusCol = selection.focus.x - originX

  return extractStreamText(
    lines as Parameters<typeof extractStreamText>[0],
    anchorRow,
    anchorCol,
    focusRow,
    focusCol
  )
}

export function resolveSelectionClipboardText(
  selection: OtuiSelection,
  tab: TabSession | undefined,
  linesOverride?: readonly TerminalLine[] | null
): { selectedText: string; streamLength: number | null; fallbackLength: number } {
  const fallback = selection.getSelectedText()
  const lines = linesOverride ?? tab?.viewport?.lines ?? null
  const streamText = lines && lines.length > 0 ? computeStreamSelectedText(selection, lines) : null
  return {
    fallbackLength: fallback.length,
    selectedText: streamText ?? fallback,
    streamLength: streamText?.length ?? null,
  }
}

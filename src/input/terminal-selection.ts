import type { TerminalLine, TerminalSpan } from '../state/types'

/**
 * A cell of a tab's terminal buffer. `row` is absolute (viewportY + screen
 * row), so a position stays on its text while the viewport scrolls.
 */
export interface CellPos {
  row: number
  col: number
}

/** Half-open: `start` is the first selected cell, `end` the one after the last. */
export interface CellRange {
  start: CellPos
  end: CellPos
}

export type SelectionMode = 'char' | 'word' | 'line'

/** The snapshot line at an absolute row, when the UI has seen it. */
export type RowSource = (row: number) => TerminalLine | undefined

function comparePos(a: CellPos, b: CellPos): number {
  return a.row - b.row || a.col - b.col
}

/**
 * The line as one string per screen column. A wide glyph fills its first
 * column and leaves '' in the second, so indices are mouse columns.
 */
export function lineCells(line: TerminalLine): string[] {
  const cells: string[] = []
  let last = -1
  for (const span of line.spans) {
    for (const char of span.text) {
      const width = Bun.stringWidth(char)
      if (width === 0 && last >= 0) {
        cells[last] += char
        continue
      }
      last = cells.length
      cells.push(char)
      if (width === 2) cells.push('')
    }
  }
  return cells
}

function isBlank(cell: string | undefined): boolean {
  return cell === undefined || (cell !== '' && !/\S/.test(cell))
}

/**
 * What one click at `pos` selects: the cell, the run of non-blank cells around
 * it, or the whole line. Word and line follow soft wraps, so a long command or
 * URL the terminal folded over several rows is still one word, one line.
 */
export function expandAt(rows: RowSource, pos: CellPos, mode: SelectionMode): CellRange {
  const cellCache = new Map<number, string[]>()
  const cellsOf = (row: number): string[] => {
    let cells = cellCache.get(row)
    if (!cells) {
      const line = rows(row)
      cells = line ? lineCells(line) : []
      cellCache.set(row, cells)
    }
    return cells
  }
  const wrapsInto = (row: number): boolean =>
    rows(row)?.wrapped === true && rows(row - 1) !== undefined

  if (mode === 'line') {
    let first = pos.row
    while (wrapsInto(first)) first -= 1
    let last = pos.row
    while (wrapsInto(last + 1)) last += 1
    return { end: { col: cellsOf(last).length, row: last }, start: { col: 0, row: first } }
  }

  const char: CellRange = { end: { col: pos.col + 1, row: pos.row }, start: pos }
  if (mode === 'char' || isBlank(cellsOf(pos.row)[pos.col])) return char

  const before = (p: CellPos): CellPos | null => {
    if (p.col > 0) return { col: p.col - 1, row: p.row }
    return wrapsInto(p.row) ? { col: cellsOf(p.row - 1).length - 1, row: p.row - 1 } : null
  }
  const after = (p: CellPos): CellPos | null => {
    if (p.col + 1 < cellsOf(p.row).length) return { col: p.col + 1, row: p.row }
    return wrapsInto(p.row + 1) ? { col: 0, row: p.row + 1 } : null
  }
  const isWordCell = (p: CellPos | null): p is CellPos =>
    p !== null && !isBlank(cellsOf(p.row)[p.col])

  let start = pos
  for (let p = before(start); isWordCell(p); p = before(p)) start = p
  let last = pos
  for (let p = after(last); isWordCell(p); p = after(p)) last = p
  return { end: { col: last.col + 1, row: last.row }, start }
}

/** The smallest range covering both: what a drag from `anchor` to `focus` selects. */
export function unionRange(anchor: CellRange, focus: CellRange): CellRange {
  return {
    end: comparePos(anchor.end, focus.end) >= 0 ? anchor.end : focus.end,
    start: comparePos(anchor.start, focus.start) <= 0 ? anchor.start : focus.start,
  }
}

export function isSameRange(a: CellRange, b: CellRange): boolean {
  return comparePos(a.start, b.start) === 0 && comparePos(a.end, b.end) === 0
}

/**
 * The selected text as the program wrote it. A row the terminal soft-wrapped
 * joins the next one with nothing in between; any other row ends in a newline,
 * minus the blank cells the snapshot pads every row with.
 */
export function selectionText(rows: RowSource, range: CellRange): string {
  let text = ''
  for (let row = range.start.row; row <= range.end.row; row += 1) {
    const line = rows(row)
    const cells = line ? lineCells(line) : []
    const from = row === range.start.row ? range.start.col : 0
    const to = row === range.end.row ? range.end.col : cells.length
    const part = cells.slice(from, to).join('')
    const joinsNext = row < range.end.row && rows(row + 1)?.wrapped === true
    text += joinsNext ? part : part.replace(/[ \t]+$/, '') + (row < range.end.row ? '\n' : '')
  }
  return text
}

/** Columns of `row` inside the range, end exclusive, or null when it is outside. */
export function rowColumns(
  range: CellRange,
  row: number,
  rowWidth: number
): [number, number] | null {
  if (row < range.start.row || row > range.end.row) return null
  return [
    row === range.start.row ? range.start.col : 0,
    row === range.end.row ? range.end.col : rowWidth,
  ]
}

/** The spans cut at the column bounds, each piece flagged as selected or not. */
export function splitSpansAtColumns(
  spans: TerminalSpan[],
  from: number,
  to: number
): { span: TerminalSpan; selected: boolean }[] {
  const pieces: { span: TerminalSpan; selected: boolean }[] = []
  let col = 0
  for (const span of spans) {
    let text = ''
    let selected = false
    for (const char of span.text) {
      const width = Bun.stringWidth(char)
      // A combining mark belongs to the glyph before it, never to a cut.
      const inRange: boolean = width === 0 && text !== '' ? selected : col >= from && col < to
      if (text !== '' && inRange !== selected) {
        pieces.push({ selected, span: { ...span, text } })
        text = ''
      }
      text += char
      selected = inRange
      col += width
    }
    if (text !== '') pieces.push({ selected, span: { ...span, text } })
  }
  return pieces
}

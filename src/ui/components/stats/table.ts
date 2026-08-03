import { truncate } from '../../truncate'

/**
 * The box-drawing half of `StatTable`, as pure string building.
 *
 * Separate from the component so it can be tested: an off-by-one in a column
 * width produces a box whose borders do not meet, and nothing in a type checker
 * or a render test would catch that.
 */

const H = '\u{2500}'
const V = '\u{2502}'
const TL = '\u{250C}'
const TR = '\u{2510}'
const BL = '\u{2514}'
const BR = '\u{2518}'
const TJ = '\u{252C}'
const BJ = '\u{2534}'
const LJ = '\u{251C}'
const RJ = '\u{2524}'
const XJ = '\u{253C}'

export interface TableColumn {
  /** Right-aligned by default: these are numbers, and numbers line up on the right. */
  align?: 'left' | 'right'
  header: string
}

export interface TableLines {
  /** Every border rule, in the order they are drawn around the rows. */
  bottom: string
  header: string
  mid: string
  rows: string[]
  top: string
}

function cell(text: string, width: number, align: 'left' | 'right'): string {
  const clipped = truncate(text, width)
  return align === 'left' ? clipped.padEnd(width) : clipped.padStart(width)
}

/** One column of padding either side of every cell, so `width + 2` per column. */
function ruleOf(widths: number[], left: string, join: string, right: string): string {
  return left + widths.map((width) => H.repeat(width + 2)).join(join) + right
}

function rowOf(cells: string[], widths: number[], columns: TableColumn[]): string {
  const inner = widths
    .map((width, index) => ` ${cell(cells[index] ?? '', width, columns[index]?.align ?? 'right')} `)
    .join(V)
  return V + inner + V
}

export function columnWidths(columns: TableColumn[], rows: string[][]): number[] {
  return columns.map((column, index) =>
    Math.max(column.header.length, ...rows.map((row) => (row[index] ?? '').length))
  )
}

/** Borders and padding: one rule between and around each column, one space either side of every cell. */
function chromeWidth(count: number): number {
  return count + 1 + count * 2
}

/**
 * Stretch or squeeze the columns so the table is exactly `target` wide.
 *
 * This is what puts the page on a grid: two tables in the same column have
 * different natural widths, and two boxes whose right edges do not line up read
 * as carelessness however good each one is on its own.
 */
function fitWidths(widths: number[], target: number): number[] {
  const count = widths.length
  if (count === 0) return widths
  const available = target - chromeWidth(count)
  const natural = widths.reduce((sum, width) => sum + width, 0)
  const out = [...widths]

  // Spread the slack a column at a time rather than proportionally, so a wide
  // column does not swallow all of it and leave the narrow ones cramped.
  let slack = available - natural
  for (let index = 0; slack > 0; index = (index + 1) % count) {
    out[index] = (out[index] ?? 0) + 1
    slack--
  }
  // Too narrow: take from the widest column each time, never below three cells,
  // which is the least that can show a character and an ellipsis.
  for (let excess = natural - available; excess > 0; excess--) {
    let widest = 0
    for (const [index, width] of out.entries()) if (width > (out[widest] ?? 0)) widest = index
    if ((out[widest] ?? 0) <= 3) break
    out[widest] = (out[widest] ?? 0) - 1
  }
  return out
}

export function buildTable(columns: TableColumn[], rows: string[][], width?: number): TableLines {
  const natural = columnWidths(columns, rows)
  const widths = width === undefined ? natural : fitWidths(natural, width)
  return {
    bottom: ruleOf(widths, BL, BJ, BR),
    header: rowOf(
      columns.map((column) => column.header),
      widths,
      columns
    ),
    mid: ruleOf(widths, LJ, XJ, RJ),
    rows: rows.map((row) => rowOf(row, widths, columns)),
    top: ruleOf(widths, TL, TJ, TR),
  }
}

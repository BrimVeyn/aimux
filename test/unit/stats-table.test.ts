import { describe, expect, test } from 'bun:test'

import { buildChart, chartColumns } from '../../src/ui/components/stats/chart'
import {
  formatClock,
  formatDayLabel,
  formatDuration,
  formatFingerDistance,
  formatPercent,
} from '../../src/ui/components/stats/format'
import { buildTable, columnWidths } from '../../src/ui/components/stats/table'

/**
 * The stats screen cannot be eyeballed from a test, so what is checked here is
 * the one thing that silently ruins it: a box whose borders do not meet.
 */

describe('buildTable', () => {
  const columns = [{ header: 'Total' }, { align: 'left' as const, header: 'Model' }]
  const rows = [
    ['1 284', 'opus-5'],
    ['7', 'haiku-4-5'],
  ]

  test('every line is exactly the same width', () => {
    const table = buildTable(columns, rows)
    const widths = new Set(
      [table.top, table.header, table.mid, ...table.rows, table.bottom].map((line) => line.length)
    )

    // The failure this guards against is one column of drift somewhere in the
    // middle, which draws a box with a step in its side.
    expect(widths.size).toBe(1)
  })

  test('columns are as wide as their widest cell, header included', () => {
    expect(columnWidths(columns, rows)).toEqual(['1 284'.length, 'haiku-4-5'.length])
    // The header wins when it is the longest thing in the column.
    expect(columnWidths([{ header: 'Daemon restarts' }], [['3']])).toEqual([15])
  })

  test('corners and junctions are drawn in the right places', () => {
    const table = buildTable(columns, rows)

    expect(table.top.startsWith('\u{250C}')).toBe(true)
    expect(table.top.endsWith('\u{2510}')).toBe(true)
    expect(table.bottom.startsWith('\u{2514}')).toBe(true)
    expect(table.bottom.endsWith('\u{2518}')).toBe(true)
    // One interior junction per seam between columns.
    expect(table.mid.split('\u{253C}')).toHaveLength(columns.length)
  })

  test('values align right and text aligns left', () => {
    const table = buildTable([{ header: 'N' }, { align: 'left', header: 'Name' }], [['7', 'ab']])
    // `│ 7 │ ab   │` — the number hugs its right edge, the name its left.
    expect(table.rows[0]).toBe('\u{2502} 7 \u{2502} ab   \u{2502}')
  })

  test('a cell longer than its column is truncated, never wrapped', () => {
    const table = buildTable([{ header: 'K' }], [['a-very-long-value']])
    // The column grows to the value here, so what this pins is that a row never
    // becomes two lines: a wrapped cell would break every border below it.
    expect(table.rows).toHaveLength(1)
    expect(table.rows[0]?.includes('\n')).toBe(false)
  })

  test('a target width is met exactly, stretching or squeezing', () => {
    for (const target of [40, 41, 60, 17]) {
      const table = buildTable(columns, rows, target)
      const lines = [table.top, table.header, table.mid, ...table.rows, table.bottom]
      // The grid depends on this: two tables in one column with different
      // natural widths must still end on the same screen column.
      expect(lines.map((line) => line.length)).toEqual(lines.map(() => target))
    }
  })

  test('slack is spread across columns, not dumped on one', () => {
    const table = buildTable(columns, rows, 40)
    const cells = table.header.split('\u{2502}').slice(1, -1)
    const widest = Math.max(...cells.map((cell) => cell.length))
    const narrowest = Math.min(...cells.map((cell) => cell.length))
    expect(widest - narrowest).toBeLessThanOrEqual(5)
  })

  test('squeezing stops before a column becomes unreadable', () => {
    // Far narrower than the content: columns shrink to their floor and the
    // table overruns rather than collapsing to nothing.
    const table = buildTable(columns, rows, 4)
    expect(table.top.length).toBe(table.bottom.length)
    expect(table.rows[0]?.length).toBe(table.top.length)
  })

  test('an empty row set still closes the box', () => {
    const table = buildTable([{ header: 'K' }], [])
    expect(table.rows).toHaveLength(0)
    expect(table.top.length).toBe(table.bottom.length)
  })
})

describe('buildChart', () => {
  test('every row is the same width and top-first', () => {
    const chart = buildChart([1, 5, 3, 8], 8)
    expect(chart.bars).toHaveLength(8)
    expect(new Set(chart.bars.map((row) => row.length)).size).toBe(1)
    expect(new Set(chart.axis.map((label) => label.length)).size).toBe(1)
  })

  test('the axis is integer all the way up', () => {
    // max 13 over 8 rows rounds the top up to 16, so every labelled row is a
    // whole number instead of 13, 9.75, 6.5…
    const chart = buildChart([13], 8)
    expect(chart.niceMax).toBe(16)
    expect(chart.axis[0]?.trim()).toBe('16')
    for (const label of chart.axis) {
      if (label.trim() === '') continue
      expect(String(Number(label.trim()))).toBe(label.trim())
    }
  })

  test('gridlines land on round numbers, not on max/height', () => {
    // 1.6M over 8 rows: the step is 200K, so the axis counts in hundreds of
    // thousands instead of 798K, 399K.
    const chart = buildChart([1_600_000, 900_000], 8)
    expect(chart.niceMax).toBe(1_600_000)
    expect(chart.axis.map((label) => label.trim()).filter((label) => label !== '')).toEqual([
      '1600000',
      '1200000',
      '800000',
      '400000',
    ])
  })

  test('the axis formatter is used for both labels and their alignment', () => {
    const chart = buildChart([1_600_000], 8, (value) => `${value / 1_000_000}M`)
    expect(chart.axis[0]?.trim()).toBe('1.6M')
    expect(new Set(chart.axis.map((label) => label.length)).size).toBe(1)
  })

  test('the tallest bar reaches the row its value earns and no further', () => {
    const chart = buildChart([8, 4], 8)
    // niceMax is 8: the first bar fills the top row, the second starts halfway.
    expect(chart.bars[0]?.startsWith('\u{258C}')).toBe(true)
    expect(chart.bars[0]?.endsWith(' ')).toBe(true)
    expect(chart.bars[4]?.endsWith('\u{258C}')).toBe(true)
    expect(chart.bars[3]?.endsWith(' ')).toBe(true)
  })

  test('one column per bar, gap included', () => {
    // The body paints half a cell, so the other half is the spacing: a bar and
    // its gap cost one column together, not two.
    const chart = buildChart([1, 2, 3, 4], 8)
    expect(chart.bars[0]).toHaveLength(4)
    expect(chartColumns(60)).toBe(60)
  })

  test('a non-zero day never disappears from the bottom row', () => {
    const chart = buildChart([1, 800], 8)
    // 1/800 rounds to nothing, but the day happened: it keeps the smallest mark
    // there is rather than rendering as a gap in the data.
    expect(chart.bars.at(-1)?.startsWith(' ')).toBe(false)
  })

  test('a half-height cap gives a second level inside each row', () => {
    // The top rounds up to 16, so 7 is three and a half rows. Without the cap
    // it would round to a whole row and read as 8 or as 6.
    const chart = buildChart([13, 7], 8)
    expect(chart.niceMax).toBe(16)
    expect(chart.bars.some((line) => line.includes('\u{2596}'))).toBe(true)

    // And a value that does land on a row boundary gets no cap.
    expect(buildChart([8, 4], 8).bars.some((line) => line.includes('\u{2596}'))).toBe(false)
  })

  test('a column is filled solid below its top', () => {
    const chart = buildChart([100], 8)
    // Only the topmost cell may be a partial block; a gap under one would draw
    // a floating segment instead of a column.
    const drawn = chart.bars.filter((line) => line.trim() !== '')
    for (const line of drawn.slice(1)) expect(line).toBe('\u{258C}')
  })

  test('an all-zero series draws an empty chart, not a crash', () => {
    const chart = buildChart([0, 0, 0], 8)
    expect(chart.bars.every((row) => row.trim() === '')).toBe(true)
  })

  test('chartColumns fits bars to the width with a floor and a ceiling', () => {
    expect(chartColumns(90)).toBe(60)
    expect(chartColumns(45)).toBe(45)
    // Capped: past two months the chart stops adding days and the heatmap is
    // where a longer span is read.
    expect(chartColumns(200)).toBe(60)
    expect(chartColumns(3)).toBe(4)
  })
})

describe('stats formatting', () => {
  test('durations pick the largest unit that is not a rounding lie', () => {
    expect(formatDuration(41_000)).toBe('41 s')
    expect(formatDuration(22 * 60_000)).toBe('22 min')
    expect(formatDuration(9 * 3_600_000 + 4 * 60_000)).toBe('9h 04')
    // Nothing recorded is `—`, not `0 s`: they mean different things.
    expect(formatDuration(0)).toBe('—')
  })

  test('clock times are zero-padded to the minute', () => {
    expect(formatClock(9 * 60 + 12)).toBe('09:12')
    expect(formatClock(23 * 60 + 48)).toBe('23:48')
  })

  test('day labels are short, and an absent day stays absent', () => {
    expect(formatDayLabel('2026-03-14')).toBe('Mar 14')
    expect(formatDayLabel('')).toBe('')
  })

  test('a percentage of nothing is not zero percent', () => {
    expect(formatPercent(3, 4)).toBe('75%')
    expect(formatPercent(0, 0)).toBe('—')
  })

  test('finger mileage scales through cm, m and km', () => {
    expect(formatFingerDistance(100)).toBe('8 cm')
    expect(formatFingerDistance(100_000)).toBe('80 m')
    expect(formatFingerDistance(3_000_000)).toBe('2.4 km')
  })
})

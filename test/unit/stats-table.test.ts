import { describe, expect, test } from 'bun:test'

import {
  buildChart,
  buildRuler,
  CHART_STRIDE,
  chartColumns,
  fitShape,
} from '../../src/ui/components/stats/chart'
import { packFacts } from '../../src/ui/components/stats/day-facts'
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
    expect(chart.bars[0]?.startsWith('\u{2588}\u{2588}')).toBe(true)
    expect(chart.bars[0]?.endsWith('  ')).toBe(true)
    expect(chart.bars[4]?.endsWith('\u{2588}\u{2588}')).toBe(true)
    expect(chart.bars[3]?.endsWith('  ')).toBe(true)
  })

  test('a bar and its gap occupy one stride', () => {
    const chart = buildChart([1, 2, 3, 4], 8)
    // Four bars, each a stride wide, less the trailing gap the last one drops.
    expect(chart.bars[0]).toHaveLength(4 * CHART_STRIDE - 1)
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
    expect(chart.bars.some((line) => line.includes('\u{2584}'))).toBe(true)

    // And a value that does land on a row boundary gets no cap.
    expect(buildChart([8, 4], 8).bars.some((line) => line.includes('\u{2584}'))).toBe(false)
  })

  test('a column is filled solid below its top', () => {
    const chart = buildChart([100], 8)
    // Only the topmost cell may be a partial block; a gap under one would draw
    // a floating segment instead of a column.
    const drawn = chart.bars.filter((line) => line.trim() !== '')
    for (const line of drawn.slice(1)) expect(line).toBe('\u{2588}\u{2588}')
  })

  test('an all-zero series draws an empty chart, not a crash', () => {
    const chart = buildChart([0, 0, 0], 8)
    expect(chart.bars.every((row) => row.trim() === '')).toBe(true)
  })

  test('chartColumns fits bars to the width with a floor and a ceiling', () => {
    expect(chartColumns(90)).toBe(30)
    expect(chartColumns(45)).toBe(15)
    // Capped: past six weeks the chart stops adding days and the heatmap is
    // where a longer span is read.
    expect(chartColumns(400)).toBe(45)
    expect(chartColumns(3)).toBe(4)
  })

  test('a narrower shape draws the same bars in fewer columns', () => {
    const wide = buildChart([1, 2, 3, 4], 8)
    const narrow = buildChart([1, 2, 3, 4], 8, String, { gap: 0, width: 1 })

    expect(wide.bars[0]).toHaveLength(4 * CHART_STRIDE - 1)
    expect(narrow.bars[0]).toHaveLength(4)
    // Same heights, only thinner: on the row only the tallest bar reaches, it
    // is one column of solid block rather than two.
    expect(narrow.bars[4]).toBe('   \u{2588}')
    expect(wide.bars[4]).toBe('         \u{2588}\u{2588}')
  })
})

describe('fitShape', () => {
  test('the widest shape that fits wins', () => {
    // 24 bars: 71 columns gapped and two wide, 48 ungapped, 47 one wide and
    // gapped, 24 at the narrowest.
    expect(fitShape(24, 100)).toEqual({ gap: 1, width: 2 })
    expect(fitShape(24, 71)).toEqual({ gap: 1, width: 2 })
    expect(fitShape(24, 70)).toEqual({ gap: 0, width: 2 })
    expect(fitShape(24, 47)).toEqual({ gap: 1, width: 1 })
    expect(fitShape(24, 30)).toEqual({ gap: 0, width: 1 })
  })

  test('a room too small for even the narrowest shape still returns one', () => {
    // Squeezed and overflowing beats no chart at all — a fixed series cannot
    // drop columns the way a rolling window can.
    expect(fitShape(24, 4)).toEqual({ gap: 0, width: 1 })
  })

  test('every shape it returns fits the room it was given', () => {
    for (let room = 24; room <= 120; room++) {
      const shape = fitShape(24, room)
      expect(24 * shape.width + 23 * shape.gap).toBeLessThanOrEqual(room)
    }
  })
})

describe('buildRuler', () => {
  test('a label sits under the bar it belongs to', () => {
    const labels = ['Jul 6', '', '', '', 'Jul 9', '', '', '']
    const ruler = buildRuler(labels)

    // Bar 0 starts at column 0, bar 4 at four strides in.
    expect(ruler.indexOf('Jul 6')).toBe(0)
    expect(ruler.indexOf('Jul 9')).toBe(4 * CHART_STRIDE)
  })

  test('the ruler is exactly as wide as the chart', () => {
    expect(buildRuler(['Jul 6', '', '', ''])).toHaveLength(4 * CHART_STRIDE)
  })

  test('a label that would collide with the one before it is dropped', () => {
    // Two labels one bar apart cannot both fit: the second would start inside
    // the first, so it goes rather than overlapping it.
    const ruler = buildRuler(['Jul 6', 'Jul 7', '', ''])
    expect(ruler.includes('Jul 7')).toBe(false)
    expect(ruler.includes('Jul 6')).toBe(true)
  })

  test('a label at the right edge slides left instead of being clipped', () => {
    // Four bars is twelve columns; a five-character label on the last one would
    // start at nine and need fourteen. The last bar is today, so the label is
    // pulled back to the edge rather than lost — but never truncated.
    const ruler = buildRuler(['', '', '', 'Jul 9'])
    expect(ruler).toHaveLength(4 * CHART_STRIDE)
    expect(ruler.trimEnd()).toHaveLength(4 * CHART_STRIDE)
    expect(ruler.includes('Jul 9')).toBe(true)
  })

  test('sliding a label left still never overlaps the one before it', () => {
    const ruler = buildRuler(['', '', 'Jul 8', 'Jul 9'])
    // Only one of the two fits once the second is pulled back.
    expect(ruler.includes('Jul 8')).toBe(true)
    expect(ruler.includes('Jul 9')).toBe(false)
  })

  test('the stride follows the bars — the hour ruler lands on its own columns', () => {
    const labels = Array.from({ length: 24 }, (_, hour) =>
      hour % 4 === 0 ? String(hour).padStart(2, '0') : ''
    )
    for (const stride of [1, 2, 3]) {
      const ruler = buildRuler(labels, stride)
      expect(ruler).toHaveLength(24 * stride)
      // Every fourth hour keeps its label at its own column, at any stride.
      expect(ruler.indexOf('04')).toBe(4 * stride)
      expect(ruler.indexOf('20')).toBe(20 * stride)
    }
  })
})

describe('packFacts', () => {
  const rows: [string, string][] = [
    ['Prompts', '42'],
    ['Busiest hour', '14:00 · 12'],
    ['Active', '09:12 → 21:40'],
    ['Sessions', '3'],
    ['Tokens', '900'],
    ['Cost', '$1.20 estimated'],
  ]

  test('facts run together until the line is full', () => {
    const lines = packFacts(rows, 40)
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(40)
    // Nothing is dropped: every label still appears somewhere.
    const joined = lines.join(' ')
    for (const [label] of rows) expect(joined).toContain(label)
  })

  test('a wide slot needs one line, a narrow one needs more', () => {
    expect(packFacts(rows, 200)).toHaveLength(1)
    expect(packFacts(rows, 30).length).toBeGreaterThan(1)
  })

  test('the last line takes the remainder rather than dropping facts', () => {
    // Two lines of room for six facts that want four: the overflow rides the
    // last line, where it truncates visibly, instead of vanishing.
    const lines = packFacts(rows, 20, 2)
    expect(lines).toHaveLength(2)
    const joined = lines.join(' ')
    for (const [label] of rows) expect(joined).toContain(label)
  })

  test('no rows means no lines, not a blank one', () => {
    expect(packFacts([], 80)).toEqual([])
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

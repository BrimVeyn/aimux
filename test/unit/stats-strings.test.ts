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
  formatSpan,
} from '../../src/ui/components/stats/format'

/**
 * The stats screen cannot be eyeballed from a test, so what is checked here is
 * the string building underneath it: an off-by-one in a chart row or a ruler
 * draws a plausible-looking picture of the wrong numbers.
 */

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

  test('a lifetime span switches to days before the hours stop meaning anything', () => {
    // Under two days the hour is still the unit a reader thinks in.
    expect(formatSpan(9 * 3_600_000 + 4 * 60_000)).toBe('9h 04')
    expect(formatSpan(47 * 3_600_000)).toBe('47h 00')
    // Past that, `1894h 58` is a number nobody reads as an amount of time.
    expect(formatSpan(48 * 3_600_000)).toBe('2d 0h')
    expect(formatSpan(1894 * 3_600_000 + 58 * 60_000)).toBe('78d 23h')
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

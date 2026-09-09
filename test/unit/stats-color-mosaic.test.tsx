import { testRender } from '@opentui/react/test-utils'
import { describe, expect, test } from 'bun:test'

import { WORKTREE_COLOR_HEX, WORKTREE_COLORS } from '../../src/platform/worktree-colors'
import { ColorMosaic } from '../../src/ui/components/stats/color-mosaic'

/**
 * The palette mosaic.
 *
 * The colours themselves cannot be read off a character frame — which is the
 * whole point of the page and the one thing a test cannot see. What has to hold
 * is that the block comes out a true rectangle at any width, that all 240
 * swatches are in it, and that the readout answers the pointer.
 */

const CELL = '\u{2584}'
/** A row that is nothing but swatches and the gaps between them. */
const ALL_CELLS = /^\u{2584}( \u{2584})*$/u
/** Sorted past the twelve hue bands: what the greys are given. */
const NEUTRAL_BAND = 12

/** The band the page sorts a `#rrggbb` into — the assertion's own arithmetic. */
function hueBandOf(hex: string): number {
  const packed = Number.parseInt(hex.slice(1), 16)
  const [r, g, b] = [(packed >> 16) & 0xff, (packed >> 8) & 0xff, packed & 0xff].map(
    (c) => c / 0xff
  )
  const max = Math.max(r ?? 0, g ?? 0, b ?? 0)
  const min = Math.min(r ?? 0, g ?? 0, b ?? 0)
  const lightness = (max + min) / 2
  const chroma = max - min
  if (chroma / (1 - Math.abs(2 * lightness - 1)) < 0.12) return NEUTRAL_BAND
  let sixth = 0
  if (max === r) sixth = (((g ?? 0) - (b ?? 0)) / chroma + 6) % 6
  else if (max === g) sixth = ((b ?? 0) - (r ?? 0)) / chroma + 2
  else sixth = ((r ?? 0) - (g ?? 0)) / chroma + 4
  return Math.floor((sixth / 6) * NEUTRAL_BAND)
}

/** What the page settles on once it is wide enough to take it. */
const PREFERRED_COLUMNS = 24

/** The row length the block should pick for a page that fits `columns` swatches. */
function widestDivisor(columns: number): number {
  let best = 1
  for (let n = 1; n <= Math.min(PREFERRED_COLUMNS, columns); n++) {
    if (WORKTREE_COLORS.length % n === 0) best = n
  }
  return best
}
const WIDE = 100

async function mount(counts: Record<string, number>, width = WIDE) {
  const { captureCharFrame, mockMouse, renderOnce } = await testRender(
    <ColorMosaic counts={counts} width={width} />,
    { height: 40, width }
  )
  await renderOnce()
  return {
    frame: captureCharFrame,
    mockMouse,
    settle: async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      await renderOnce()
    },
  }
}

/** The rows made entirely of swatches — the block, without its readout. */
function blockRows(frame: string): string[] {
  return frame
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => ALL_CELLS.test(line))
}

describe('stats colors page', () => {
  test('the block is one rectangle holding every colour, at any width', async () => {
    for (const width of [WIDE, 60, 40]) {
      const { frame } = await mount({}, width)
      const rows = blockRows(frame())
      const first = rows[0] ?? ''
      expect(rows.length).toBeGreaterThan(0)
      // Every row the same length is what makes it a rectangle rather than a
      // block with a stub hanging off the bottom.
      for (const row of rows) expect(row).toBe(first)
      // A swatch and its gap, less the gap the last swatch in a row does not get.
      const columns = (first.length + 1) / 2
      expect(rows.length * columns).toBe(WORKTREE_COLORS.length)
      expect(first.length).toBeLessThanOrEqual(width)
      // The block holds its shape instead of stretching into a strip, and a
      // pool size with no divisor near it would tile as 240 rows of one swatch.
      expect(columns).toBe(widestDivisor(Math.floor(width / 2)))
    }
  })

  test('the readout opens on the most-used colour and follows the pointer', async () => {
    const { frame, mockMouse, settle } = await mount({ crimson: 5, teal: 1 })
    expect(frame()).toContain(`${CELL}${CELL} crimson \u{00B7} 5 workspaces`)

    // The first swatch of the block: alphabetically first in the pool, and one
    // nothing has been named after.
    const top = frame()
      .split('\n')
      .findIndex((line) => line.trim().startsWith(CELL))
    await mockMouse.moveTo(1, top)
    await settle()
    expect(frame()).toContain(`${WORKTREE_COLORS[0] ?? ''} \u{00B7} never used`)
  })

  test('the note counts what has been used', async () => {
    const { frame } = await mount({ crimson: 5, teal: 1 })
    expect(frame()).toContain(`2 of ${String(WORKTREE_COLORS.length)} used`)
  })

  test('the pool reads as a spectrum, with the greys behind it', async () => {
    const bands = WORKTREE_COLORS.map((color) => hueBandOf(WORKTREE_COLOR_HEX[color] ?? ''))
    // Non-decreasing: every colour sits in a band at or after its predecessor's,
    // which is what makes the block sweep the wheel instead of scattering.
    for (const [index, band] of bands.entries()) {
      expect(band).toBeGreaterThanOrEqual(bands[index - 1] ?? 0)
    }
    // And the greys are the tail, not dull dots sprinkled through the rainbow.
    expect(bands.at(-1)).toBe(NEUTRAL_BAND)
    expect(bands[0]).toBeLessThan(NEUTRAL_BAND)
  })
})

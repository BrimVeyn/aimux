import type { BoxRenderable, MouseEvent } from '@opentui/core'

import { useCallback, useRef, useState } from 'react'

import {
  WORKTREE_COLOR_HEX,
  WORKTREE_COLORS,
  type WorktreeColorCounts,
} from '../../../platform/worktree-colors'
import { useTheme } from '../../theme'
import { formatCount } from './format'
import { GLYPH, Section } from './shared'

/**
 * The palette workspace directories are named out of, and how far into it this
 * install has got.
 *
 * One solid rectangle and nothing else. A colour that has never named a
 * workspace is drawn in the neutral every other unset thing on the screen wears,
 * and one that has lights up in the colour it is actually called, so how much of
 * the palette is spent is a thing you see rather than a number you read.
 *
 * No names on the grid. A label beside every swatch turns the block into a list
 * with dots in front of it — the shape is the point, and the name is one line
 * below, under the pointer.
 *
 * The only place in the app a literal hex is correct: here the colour is not
 * decoration on top of a name, it *is* the name.
 */

/**
 * Lower half block: square edges, and half a cell tall.
 *
 * The height is what makes it a mosaic. A full block fills its cell top to
 * bottom, so stacked rows touch and 240 of them merge into one grey band with
 * confetti in it — the bar charts on the other pages are drawn half-height for
 * the same reason. The empty top half of each cell is the gap above every
 * swatch, for free, and the blank column beside it is the gap to its right.
 */
const CELL = '\u{2584}'
/** The swatch and its gap — the stride one colour occupies. */
const CELL_WIDTH = 2

/**
 * How wide the block wants to be.
 *
 * Not "as wide as the page": 240 swatches across a wide terminal is two rows,
 * and two rows is a strip, not a mosaic. Fixed instead, so the block is the same
 * shape on every terminal — 24 by 10, which comes out roughly twice as wide as
 * it is tall once a cell's own 1:2 proportions are taken into account.
 */
const PREFERRED_COLUMNS = 24
/** The blank row between the mosaic and its readout, and the readout itself. */
const READOUT_ROWS = 2

/**
 * Swatches per row: the widest divisor of the pool that fits, up to the
 * preferred width.
 *
 * A divisor, not `floor(usable / CELL_WIDTH)`, because the last row of a grid
 * that does not divide is a stub hanging off the bottom of the block — and the
 * block reading as one rectangle is the whole design.
 */
function mosaicColumns(usable: number): number {
  const fits = Math.min(PREFERRED_COLUMNS, Math.max(1, Math.floor(usable / CELL_WIDTH)))
  let best = 1
  for (let columns = 1; columns <= fits; columns++) {
    if (WORKTREE_COLORS.length % columns === 0) best = columns
  }
  return best
}

/** How many colours have named something — the section's note. */
function usedCount(counts: WorktreeColorCounts): number {
  let used = 0
  for (const color of WORKTREE_COLORS) if ((counts[color] ?? 0) > 0) used++
  return used
}

/** The colour the readout opens on: the one this install reaches for most. */
function favouriteColor(counts: WorktreeColorCounts): string {
  let best = WORKTREE_COLORS[0] ?? ''
  for (const color of WORKTREE_COLORS) {
    if ((counts[color] ?? 0) > (counts[best] ?? 0)) best = color
  }
  return best
}

/**
 * What the pointer is on: the swatch in its own colour, its name, and its tally.
 *
 * A fixed row under the block rather than a box over it. A popover has a state
 * to open and to dismiss, and it covers the very thing it is describing — the
 * activity calendar learned this the hard way and reads its days the same way
 * this reads its colours.
 */
function Readout({ color, count }: { color: string; count: number }) {
  const t = useTheme()
  return (
    <box flexDirection="row" flexShrink={0}>
      <text fg={WORKTREE_COLOR_HEX[color]} selectable={false} wrapMode="none">
        {`${CELL.repeat(CELL_WIDTH)} `}
      </text>
      <text fg={t.text} selectable={false} wrapMode="none">
        {color}
      </text>
      <text fg={t.textMuted} selectable={false} wrapMode="none">
        {count === 0
          ? ' \u{00B7} never used'
          : ` \u{00B7} ${formatCount(count)} workspace${count === 1 ? '' : 's'}`}
      </text>
    </box>
  )
}

/** One row of the block. Every swatch is its own colour, so there is nothing to batch. */
function MosaicRow({
  colors,
  counts,
  hovered,
}: {
  colors: readonly string[]
  counts: WorktreeColorCounts
  hovered: string | null
}) {
  const t = useTheme()
  // The pointer's own swatch drops to the page's ink, the way the calendar marks
  // the day under the cursor. It costs that one colour for as long as the
  // pointer is on it, which is exactly when the readout below is showing it.
  const inkOf = (color: string) => {
    if (color === hovered) return t.text
    return (counts[color] ?? 0) > 0 ? WORKTREE_COLOR_HEX[color] : t.borderSubtle
  }
  return (
    <box flexDirection="row" flexShrink={0}>
      {colors.map((color) => (
        <text key={color} fg={inkOf(color)} selectable={false} wrapMode="none">
          {`${CELL} `}
        </text>
      ))}
    </box>
  )
}

export function ColorMosaic({ counts, width }: { counts: WorktreeColorCounts; width: number }) {
  const boxRef = useRef<BoxRenderable | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)

  const columns = mosaicColumns(width)
  const rows = WORKTREE_COLORS.length / columns

  /**
   * The block is a fixed pitch, so where the pointer is is arithmetic rather
   * than a hit test on 240 cells. Mouse-down runs the same path as movement, so
   * the readout still answers a click on a terminal with no motion reporting.
   */
  const handlePoint = useCallback(
    (event: MouseEvent) => {
      const box = boxRef.current
      if (box === null) return
      const row = event.y - box.y
      const column = Math.floor((event.x - box.x) / CELL_WIDTH)
      if (row < 0 || column < 0 || column >= columns) return
      const color = WORKTREE_COLORS[row * columns + column]
      // Off the end of the block leaves the last colour up rather than blanking
      // the row as the pointer crosses out of it.
      if (color === undefined) return
      setHovered(color)
    },
    [columns]
  )

  const shown = hovered ?? favouriteColor(counts)

  return (
    <Section
      glyph={GLYPH.colors}
      title="Palette"
      note={`${formatCount(usedCount(counts))} of ${formatCount(WORKTREE_COLORS.length)} used`}
      width={width}
    >
      <box
        ref={boxRef}
        flexDirection="column"
        flexShrink={0}
        alignSelf="flex-start"
        onMouseDown={handlePoint}
        onMouseMove={handlePoint}
      >
        {Array.from({ length: rows }, (_, row) => (
          <MosaicRow
            key={WORKTREE_COLORS[row * columns]}
            colors={WORKTREE_COLORS.slice(row * columns, (row + 1) * columns)}
            counts={counts}
            hovered={hovered}
          />
        ))}
      </box>
      <box height={READOUT_ROWS - 1} flexShrink={0} />
      <Readout color={shown} count={counts[shown] ?? 0} />
    </Section>
  )
}

import type { RGBA } from '@opentui/core'

import { useMemo } from 'react'

import type { UsageDays } from '../../../services/usage-history/store'

import {
  buildHeatmap,
  coveredWeeks,
  type HeatmapCell,
  mixColor,
  promptCounts,
} from '../../../services/usage-history/stats'
import { useTheme } from '../../theme'

/**
 * The activity calendar.
 *
 * A spaced cell (`▪` plus a column of gap) rather than a solid block: the gaps are
 * what make it read as a grid of days instead of a wall of colour, and an empty
 * day stays visible as a muted square rather than a hole.
 *
 * The ramp is sequential — one hue, light to dark — because the value it encodes
 * is magnitude. Its steps come from the theme's own success colour, so it follows
 * whatever theme is loaded.
 */

const CELL = '\u{25AA}'
const CELL_WIDTH = 2
const GUTTER = 4
const ROW_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'] as const
const ROW_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Three-letter month name over the column that opens each month. */
function monthRuler(grid: HeatmapCell[][], weeks: number): string {
  const chars: string[] = Array.from({ length: weeks * CELL_WIDTH }, () => ' ')
  let previous = ''
  for (let column = 0; column < weeks; column++) {
    const day = grid[0]?.[column]?.day
    if (day == null || day === '') continue
    const month = day.slice(5, 7)
    if (month === previous) continue
    previous = month
    const name = MONTHS[Number(month) - 1] ?? ''
    // Dropped rather than clipped when the year ends mid-label: a stray `Ja` at
    // the right edge reads as a rendering bug.
    if (column * CELL_WIDTH + name.length > chars.length) continue
    for (let offset = 0; offset < name.length; offset++) {
      chars[column * CELL_WIDTH + offset] = name[offset] ?? ' '
    }
  }
  return chars.join('')
}

function Gutter({ label }: { label: string }) {
  const t = useTheme()
  return (
    <box width={GUTTER} flexShrink={0}>
      <text fg={t.textMuted} selectable={false} wrapMode="none">
        {label}
      </text>
    </box>
  )
}

function HeatRow({
  cells,
  label,
  ramp,
}: {
  cells: HeatmapCell[]
  label: string
  ramp: (string | RGBA)[]
}) {
  const t = useTheme()

  // One <text> per colour run, not per cell: a full year is 371 cells.
  const runs: { color: RGBA | string; start: number; text: string }[] = []
  for (const [index, cell] of cells.entries()) {
    const color = ramp[cell.level] ?? t.textMuted
    const glyph = cell.day === '' ? '  ' : `${CELL} `
    const last = runs.at(-1)
    if (last !== undefined && last.color === color) last.text += glyph
    else runs.push({ color, start: index, text: glyph })
  }

  return (
    <box flexDirection="row" flexShrink={0}>
      <Gutter label={label} />
      {runs.map((run) => (
        <text key={run.start} fg={run.color} selectable={false} wrapMode="none">
          {run.text}
        </text>
      ))}
    </box>
  )
}

export function HeatmapLegend({ ramp }: { ramp: (string | RGBA)[] }) {
  const t = useTheme()
  return (
    <box flexDirection="row" flexShrink={0}>
      <text fg={t.textMuted} selectable={false} wrapMode="none">
        {'Less '}
      </text>
      {ramp.map((color, index) => (
        <text key={String(color) + String(index)} fg={color} selectable={false} wrapMode="none">
          {`${CELL} `}
        </text>
      ))}
      <text fg={t.textMuted} selectable={false} wrapMode="none">
        More
      </text>
    </box>
  )
}

export function useHeatmapRamp(): (string | RGBA)[] {
  const t = useTheme()
  // borderSubtle rather than a background token: backgrounds resolve to alpha 0
  // in transparent mode, which would erase the empty days entirely.
  return useMemo(
    () => [
      t.borderSubtle,
      mixColor(t.borderSubtle, t.success, 0.35),
      mixColor(t.borderSubtle, t.success, 0.6),
      mixColor(t.borderSubtle, t.success, 0.82),
      t.success,
    ],
    [t.borderSubtle, t.success]
  )
}

export function Heatmap({
  days,
  ramp,
  today,
  width,
}: {
  days: UsageDays
  ramp: (string | RGBA)[]
  today: Date
  width: number
}) {
  const t = useTheme()
  const usable = Math.max(8, width - GUTTER)
  // Bounded by what is recorded: empty months predating the first rollup read as
  // broken, not as history.
  const weeks = coveredWeeks(
    days,
    today,
    Math.max(4, Math.min(53, Math.floor(usable / CELL_WIDTH)))
  )
  const grid = buildHeatmap(promptCounts(days), weeks, today)

  return (
    <box flexDirection="column" flexShrink={0}>
      <box flexDirection="row" flexShrink={0}>
        <Gutter label="" />
        <text fg={t.textMuted} selectable={false} wrapMode="none">
          {monthRuler(grid, weeks)}
        </text>
      </box>
      {grid.map((cells, index) => (
        <HeatRow key={ROW_KEYS[index]} cells={cells} label={ROW_LABELS[index] ?? ''} ramp={ramp} />
      ))}
    </box>
  )
}

import type { RGBA } from '@opentui/core'

import { useMemo } from 'react'

import type { UsageDays } from '../../../services/usage-history/store'

import {
  buildHeatmap,
  coveredWeeks,
  type HeatmapCell,
  mixColor,
  monthLabels,
  promptCounts,
} from '../../../services/usage-history/stats'
import { useTheme } from '../../theme'

/**
 * The activity calendar.
 *
 * A cell is `md-square_rounded`, a filled rounded square that fills its terminal
 * cell. Unicode has no filled rounded square — `▢` U+25A2 is an outline — so
 * this is a nerd-font glyph, like the status bar's round separator and the usage
 * indicator's tool marks. One column of gap after each keeps the grid reading as
 * days rather than as one long bar.
 *
 * **Hue is the month, lightness is the value.** The four-hue cycle groups the
 * calendar into months without drawing gridlines between them, and within a
 * month the ramp runs light to dark on that hue. Colour is never alone: the
 * month's name sits above its columns in the same hue, which is what says the
 * hue means "March" and not "bad".
 *
 * The hues come from the theme's own `success`/`info`/`warning`/`error`, which
 * are the only four tokens reliably distinct across every bundled theme —
 * several themes resolve `primary`, `accent` and `info` to the same colour.
 */

/** nf-md-square_rounded. Needs a nerd font, and measures one cell wide. */
const CELL = '\u{F14FB}'
/** The glyph plus its gap — the stride one day occupies. */
const CELL_WIDTH = 2
const BLANK = ' '.repeat(CELL_WIDTH)
const LABEL_WIDTH = 5

const ROW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
/** A constant, not an inline attribute: a JSX string does not process `\u` escapes. */
const CHEVRON = '\u{00BB}'
const RULE = '\u{2500}'

type Ramp = (RGBA | string)[]

/** Light to dark on one hue, over the neutral an unrecorded day keeps. */
function rampOf(empty: string, hue: string): Ramp {
  return [
    empty,
    mixColor(empty, hue, 0.35),
    mixColor(empty, hue, 0.6),
    mixColor(empty, hue, 0.82),
    hue,
  ]
}

/** One ramp per month hue, cycling every four months. */
export function useMonthRamps(): Ramp[] {
  const t = useTheme()
  // borderSubtle rather than a background token: backgrounds resolve to alpha 0
  // in transparent mode, which would erase the empty days entirely.
  return useMemo(
    () => [t.success, t.info, t.warning, t.error].map((hue) => rampOf(t.borderSubtle, hue)),
    [t.borderSubtle, t.error, t.info, t.success, t.warning]
  )
}

function rampFor(ramps: Ramp[], month: number): Ramp {
  return ramps[month % ramps.length] ?? ramps[0] ?? []
}

/** The ramp a legend should show: one hue, so it reads as magnitude alone. */
export function HeatmapLegend({ ramps }: { ramps: Ramp[] }) {
  const t = useTheme()
  const ramp = ramps[0] ?? []
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

function Gutter({ label }: { label: string }) {
  const t = useTheme()
  return (
    <box width={LABEL_WIDTH} flexShrink={0}>
      <text fg={t.textMuted} selectable={false} wrapMode="none">
        {label}
      </text>
    </box>
  )
}

function HeatRow({ cells, label, ramps }: { cells: HeatmapCell[]; label: string; ramps: Ramp[] }) {
  // One <text> per colour run, not per cell: a year is 371 of them.
  const runs: { color: RGBA | string; start: number; text: string }[] = []
  for (const [index, cell] of cells.entries()) {
    if (cell.day === '') {
      const last = runs.at(-1)
      if (last !== undefined && last.color === '') last.text += BLANK
      else runs.push({ color: '', start: index, text: BLANK })
      continue
    }
    const month = Number(cell.day.slice(5, 7)) - 1
    const color = rampFor(ramps, month)[cell.level] ?? ''
    const last = runs.at(-1)
    if (last !== undefined && last.color === color) last.text += `${CELL} `
    else runs.push({ color, start: index, text: `${CELL} ` })
  }

  return (
    <box flexDirection="row" flexShrink={0}>
      <Gutter label={label} />
      {runs.map((run) =>
        run.color === '' ? (
          <text key={run.start} selectable={false} wrapMode="none">
            {run.text}
          </text>
        ) : (
          <text key={run.start} fg={run.color} selectable={false} wrapMode="none">
            {run.text}
          </text>
        )
      )}
    </box>
  )
}

/** Month names over their own columns, each in that month's hue. */
function MonthHeader({
  grid,
  ramps,
  weeks,
}: {
  grid: HeatmapCell[][]
  ramps: Ramp[]
  weeks: number
}) {
  const t = useTheme()
  const labels = monthLabels(grid, weeks, CELL_WIDTH)

  let cursor = 0
  const runs: { color: RGBA | string; key: string; text: string }[] = []
  for (const label of labels) {
    if (label.offset > cursor) {
      runs.push({
        color: '',
        key: `gap${String(label.offset)}`,
        text: ' '.repeat(label.offset - cursor),
      })
    }
    runs.push({
      color: rampFor(ramps, label.month).at(-1) ?? t.text,
      key: `${label.name}${String(label.offset)}`,
      text: label.name,
    })
    cursor = label.offset + label.name.length
  }

  return (
    <box flexDirection="row" flexShrink={0}>
      <Gutter label={CHEVRON} />
      {runs.map((run) =>
        run.color === '' ? (
          <text key={run.key} selectable={false} wrapMode="none">
            {run.text}
          </text>
        ) : (
          <text key={run.key} fg={run.color} selectable={false} wrapMode="none">
            {run.text}
          </text>
        )
      )}
    </box>
  )
}

export function Heatmap({
  days,
  ramps,
  today,
  width,
}: {
  days: UsageDays
  ramps: Ramp[]
  today: Date
  width: number
}) {
  const t = useTheme()
  // Less the day-name column and the box's own border and padding, so the grid
  // sizes to what is actually left inside it.
  const usable = Math.max(CELL_WIDTH, width - LABEL_WIDTH - 4)
  // Bounded by what is recorded: empty months predating the first rollup read as
  // broken, not as history.
  const weeks = coveredWeeks(
    days,
    today,
    Math.max(4, Math.min(53, Math.floor(usable / CELL_WIDTH)))
  )
  const grid = buildHeatmap(promptCounts(days), weeks, today)

  return (
    <box
      border
      borderStyle="rounded"
      borderColor={t.border}
      paddingLeft={1}
      paddingRight={1}
      flexDirection="column"
      flexShrink={0}
      alignSelf="flex-start"
    >
      <MonthHeader grid={grid} ramps={ramps} weeks={weeks} />
      <box flexDirection="row" flexShrink={0}>
        <Gutter label="" />
        <text fg={t.borderSubtle} selectable={false} wrapMode="none">
          {RULE.repeat(weeks * CELL_WIDTH)}
        </text>
      </box>
      {grid.map((cells, index) => (
        <HeatRow
          key={ROW_LABELS[index]}
          cells={cells}
          label={ROW_LABELS[index] ?? ''}
          ramps={ramps}
        />
      ))}
    </box>
  )
}

import type { BoxRenderable, MouseEvent, RGBA } from '@opentui/core'

import { useCallback, useMemo, useRef, useState } from 'react'

import {
  buildHeatmap,
  coveredWeeks,
  type HeatmapCell,
  mixColor,
  monthLabels,
  promptCounts,
} from '../../../services/usage-history/stats'
import { localDay, type UsageDays } from '../../../services/usage-history/store'
import { useTheme } from '../../theme'
import { dayDetails, DayFacts, DayPanel, PANEL_WIDTH } from './day-facts'

/**
 * The activity calendar.
 *
 * A cell is `md-square_rounded`, a filled rounded square that fills its
 * terminal cell. Unicode has no filled rounded square — `▢` U+25A2 is an
 * outline — so this is a nerd-font glyph, like the status bar's round separator.
 *
 * One hue, light to dark, because the only thing a cell encodes is magnitude.
 * A hue per month grouped the calendar prettily but spent the colour channel on
 * something the month labels already say, and it borrowed the status colours,
 * which on this page mean a quota is running out.
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

/** Rows the grid draws above the first weekday: the month header and its rule. */
const HEADER_ROWS = 2
/** The box's own border and padding on the left. */
const BOX_INSET = 2
/** Between the calendar and the day panel beside it. */
const PANEL_GAP = 2
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

export function useHeatmapRamp(): Ramp {
  const t = useTheme()
  // borderSubtle rather than a background token: backgrounds resolve to alpha 0
  // in transparent mode, which would erase the empty days entirely.
  return useMemo(() => rampOf(t.borderSubtle, t.primary), [t.borderSubtle, t.primary])
}

export function HeatmapLegend({ ramp }: { ramp: Ramp }) {
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

function HeatRow({
  cells,
  label,
  ramp,
  selected,
}: {
  cells: HeatmapCell[]
  label: string
  ramp: Ramp
  selected: number
}) {
  const t = useTheme()

  // One <text> per colour run, not per cell: a year is 371 of them.
  const runs: { color: RGBA | string; start: number; text: string }[] = []
  for (const [index, cell] of cells.entries()) {
    let color: RGBA | string = ''
    if (cell.day !== '') {
      color = index === selected ? t.text : (ramp[cell.level] ?? t.borderSubtle)
    }
    const glyph = cell.day === '' ? BLANK : `${CELL} `
    const last = runs.at(-1)
    // The selected cell always starts its own run, so it keeps its own colour.
    if (last !== undefined && last.color === color && index !== selected) last.text += glyph
    else runs.push({ color, start: index, text: glyph })
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

/** Month names over the columns they occupy. */
function MonthHeader({ grid, weeks }: { grid: HeatmapCell[][]; weeks: number }) {
  const t = useTheme()
  const labels = monthLabels(grid, weeks, CELL_WIDTH)

  let cursor = 0
  const parts: string[] = []
  for (const label of labels) {
    parts.push(' '.repeat(Math.max(0, label.offset - cursor)), label.name)
    cursor = label.offset + label.name.length
  }

  return (
    <box flexDirection="row" flexShrink={0}>
      <Gutter label={CHEVRON} />
      <text fg={t.textMuted} selectable={false} wrapMode="none">
        {parts.join('')}
      </text>
    </box>
  )
}

interface Selection {
  column: number
  key: string
  row: number
}

/**
 * How many weeks the grid draws in `width` columns.
 *
 * Bounded by what is recorded: empty months predating the first rollup read as
 * broken, not as history.
 */
function weeksFor(days: UsageDays, today: Date, width: number): number {
  // Less the day-name column and the box's own border and padding, so the grid
  // sizes to what is actually left inside it.
  const usable = Math.max(CELL_WIDTH, width - LABEL_WIDTH - 4)
  return coveredWeeks(days, today, Math.max(4, Math.min(53, Math.floor(usable / CELL_WIDTH))))
}

/**
 * The columns the calendar's box actually occupies.
 *
 * The section's legend is pinned to this rather than to the pane, so it sits
 * over the grid's own top-right corner: the calendar is as wide as the history
 * is long, and a legend flush with the far edge of the page belongs to nothing
 * the eye can see.
 */
export function heatmapWidth(days: UsageDays, today: Date, width: number): number {
  return BOX_INSET * 2 + LABEL_WIDTH + weeksFor(days, today, width) * CELL_WIDTH
}

export function Heatmap({
  days,
  ramp,
  summary,
  today,
  width,
}: {
  days: UsageDays
  ramp: Ramp
  /** What the whole calendar says, above the day the pointer is on. */
  summary?: string
  today: Date
  width: number
}) {
  const t = useTheme()
  const boxRef = useRef<BoxRenderable | null>(null)
  const [selected, setSelected] = useState<Selection | null>(null)

  const weeks = weeksFor(days, today, width)
  const grid = buildHeatmap(promptCounts(days), weeks, today)

  /**
   * The grid is a fixed pitch, so where the pointer is is arithmetic rather
   * than a hit test: one handler beats a handler on each of 371 cells, and the
   * cells stay batched into colour runs for rendering.
   *
   * Movement rather than clicks. Reading a day was a mode — open the popover,
   * read it, dismiss it — for numbers that take a second to scan, and the box
   * covered the month it was describing. Following the pointer has no state to
   * open or to get stuck in, and scanning a week is a sweep rather than a dozen
   * clicks. Mouse-down runs the same path so the readout still answers a click,
   * which is what a terminal without motion reporting will send.
   */
  const handlePoint = useCallback(
    (event: MouseEvent) => {
      const box = boxRef.current
      if (box === null) return
      const row = event.y - box.y - HEADER_ROWS - 1
      const column = Math.floor((event.x - box.x - BOX_INSET - LABEL_WIDTH) / CELL_WIDTH)
      const key = grid[row]?.[column]?.day
      // A cell with no day behind it — the future, or before the first rollup —
      // leaves the last one up rather than blanking the slot as the pointer
      // crosses it.
      if (key == null || key === '') return
      setSelected((current) => (current?.key === key ? current : { column, key, row }))
    },
    [grid]
  )

  // Today until the pointer says otherwise: the slot is worth its rows from the
  // moment the page opens, and today is the day a reader wants first.
  const shown = selected?.key ?? localDay(today)
  const details = useMemo(() => dayDetails(shown, days[shown]), [days, shown])

  // The calendar is bounded by what has been recorded, so it usually leaves
  // room to its right. The panel goes there when it fits, and drops to running
  // lines underneath when it does not.
  const beside = width - heatmapWidth(days, today, width) - PANEL_GAP >= PANEL_WIDTH

  return (
    <box flexDirection="column" flexShrink={0} alignSelf="flex-start">
      <box flexDirection="row" flexShrink={0}>
        <box
          ref={boxRef}
          border
          borderStyle="rounded"
          borderColor={t.border}
          paddingLeft={1}
          paddingRight={1}
          flexDirection="column"
          flexShrink={0}
          onMouseDown={handlePoint}
          onMouseMove={handlePoint}
        >
          <MonthHeader grid={grid} weeks={weeks} />
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
              ramp={ramp}
              selected={selected?.row === index ? selected.column : -1}
            />
          ))}
        </box>
        {beside ? (
          <>
            <box width={PANEL_GAP} flexShrink={0} />
            <DayPanel details={details} />
          </>
        ) : null}
      </box>
      {summary == null || summary === '' ? null : (
        <text fg={t.textMuted} selectable={false} wrapMode="none">
          {summary}
        </text>
      )}
      {/* Below only when it could not go beside. The date line is the only
          bright text down here, so the year and the day never read as one
          paragraph. */}
      {beside ? null : <DayFacts details={details} width={width} />}
    </box>
  )
}

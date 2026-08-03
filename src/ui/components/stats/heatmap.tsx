import type { BoxRenderable, MouseEvent, RGBA } from '@opentui/core'

import { useCallback, useMemo, useRef, useState } from 'react'

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
import { dayDetails, DayPopover, placePopover, popoverSize } from './day-popover'

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
/** Border, header, seven weekdays, border. */
const GRID_HEIGHT = 1 + HEADER_ROWS + 7 + 1
/** Over the grid rather than under it. */
const POPOVER_Z = 10

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

export function Heatmap({
  days,
  ramp,
  today,
  width,
}: {
  days: UsageDays
  ramp: Ramp
  today: Date
  width: number
}) {
  const t = useTheme()
  const boxRef = useRef<BoxRenderable | null>(null)
  const [selected, setSelected] = useState<Selection | null>(null)

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

  /**
   * The grid is a fixed pitch, so where a click landed is arithmetic rather
   * than a hit test: one handler on the box beats a handler on each of 371
   * cells, and the cells stay batched into colour runs for rendering.
   */
  const handleClick = useCallback(
    (event: MouseEvent) => {
      const box = boxRef.current
      if (box === null) return
      const row = event.y - box.y - HEADER_ROWS - 1
      const column = Math.floor((event.x - box.x - BOX_INSET - LABEL_WIDTH) / CELL_WIDTH)
      const key = grid[row]?.[column]?.day
      setSelected((current) => {
        // A second click on the same cell closes it, and a click on a cell with
        // no day behind it — the future, or before the first rollup — clears.
        if (key == null || key === '') return null
        if (current?.key === key) return null
        return { column, key, row }
      })
    },
    [grid]
  )

  const details = useMemo(
    () => (selected === null ? null : dayDetails(selected.key, days[selected.key])),
    [days, selected]
  )
  // Placed on the far side of the cell from the nearest edge, so the popover
  // opens into the room there is and leaves the cell you clicked visible.
  const size = details === null ? null : popoverSize(details)
  const placement =
    size === null || selected === null
      ? null
      : placePopover({
          cellX: BOX_INSET + LABEL_WIDTH + selected.column * CELL_WIDTH,
          cellY: 1 + HEADER_ROWS + selected.row,
          gridHeight: GRID_HEIGHT,
          gridWidth: BOX_INSET * 2 + LABEL_WIDTH + weeks * CELL_WIDTH,
          size,
        })

  return (
    <box flexDirection="column" flexShrink={0} alignSelf="flex-start">
      <box
        ref={boxRef}
        border
        borderStyle="rounded"
        borderColor={t.border}
        paddingLeft={1}
        paddingRight={1}
        flexDirection="column"
        flexShrink={0}
        onMouseDown={handleClick}
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
      {details === null || placement === null ? null : (
        <box position="absolute" left={placement.left} top={placement.top} zIndex={POPOVER_Z}>
          <DayPopover details={details} />
        </box>
      )}
    </box>
  )
}

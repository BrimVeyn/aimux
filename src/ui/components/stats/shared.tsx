import type { RGBA } from '@opentui/core'
import type { ReactNode } from 'react'

import { useTheme } from '../../theme'
import { truncate } from '../../truncate'
import { buildChart } from './chart'
import { buildTable, type TableColumn } from './table'

export type { TableColumn } from './table'

/**
 * The stats screen's building blocks.
 *
 * Density comes from bordered tables — one header row over one value row — rather
 * than a stack of label/value lines each under its own heading. A five-column
 * table says in five rows what fifteen stacked rows used to.
 *
 * Colour follows one rule throughout: **text wears text tokens**. Values and
 * labels stay in `text`/`textMuted`, and a coloured mark beside them carries the
 * meaning. The only coloured glyphs are the sequential heatmap ramp (one hue,
 * light to dark) and the reserved status colours on quota bars.
 */

/**
 * Section glyphs, as constants rather than inline attributes: a JSX string
 * attribute does not process `\u` escapes, so `glyph="\u{25D4}"` renders the
 * backslash. All single-cell, text-presentation, present in the base fonts.
 */
export const GLYPH = {
  aimux: '\u{2318}',
  branches: '\u{2442}',
  burn: '\u{25B3}',
  calendar: '\u{25A4}',
  clock: '\u{25F4}',
  cost: '\u{0024}',
  distance: '\u{2192}',
  keyboard: '\u{2328}',
  models: '\u{25C8}',
  projects: '\u{2632}',
  quota: '\u{25D4}',
  records: '\u{2605}',
  sessions: '\u{29C9}',
  streak: '\u{25B2}',
  tokens: '\u{25A6}',
  week: '\u{25A6}',
} as const

/**
 * A bordered grid. Each line is one `<text>`, coloured as a whole — headers muted,
 * values in the text token, rules in the subtle border. Per-cell colour would mean
 * one node per cell, and a table is drawn far more often than it is read for a
 * single highlighted number.
 */
export function StatTable({
  columns,
  rows,
  width,
}: {
  columns: TableColumn[]
  rows: string[][]
  /** Fill exactly this many columns, so tables stacked in one column share an edge. */
  width?: number
}) {
  const t = useTheme()
  const table = buildTable(columns, rows, width)

  return (
    <box flexDirection="column" flexShrink={0}>
      <text fg={t.borderSubtle} selectable={false} wrapMode="none">
        {table.top}
      </text>
      <text fg={t.textMuted} selectable={false} wrapMode="none">
        {table.header}
      </text>
      <text fg={t.borderSubtle} selectable={false} wrapMode="none">
        {table.mid}
      </text>
      {table.rows.map((line, index) => (
        <text key={line + String(index)} fg={t.text} selectable={false} wrapMode="none">
          {line}
        </text>
      ))}
      <text fg={t.borderSubtle} selectable={false} wrapMode="none">
        {table.bottom}
      </text>
    </box>
  )
}

const RULE = '\u{2500}'

/** A horizontal rule, exactly `width` cells. The page's only separator. */
export function Rule({ width }: { width: number }) {
  const t = useTheme()
  return (
    <text fg={t.borderSubtle} selectable={false} wrapMode="none">
      {RULE.repeat(Math.max(0, width))}
    </text>
  )
}

/**
 * A section: glyph and title on the left, a note pinned to the right edge of the
 * column, a rule under both.
 *
 * The rule is what does the separating — every section is the same width and
 * every note lands on the same column, so the page reads as a grid rather than
 * as blocks that happen to sit near each other.
 */
export function Section({
  children,
  glyph,
  note,
  rule = true,
  title,
  width,
}: {
  children: ReactNode
  glyph: string
  /** A string, or a component when the note is itself a legend. */
  note?: ReactNode
  /** Off when the content draws its own box — a rule over a border is two lines saying one thing. */
  rule?: boolean
  title: string
  width: number
}) {
  const t = useTheme()
  return (
    <box flexDirection="column" flexShrink={0} paddingBottom={1}>
      <box width={width} flexDirection="row" flexShrink={0}>
        <text fg={t.primary} selectable={false} wrapMode="none">
          {`${glyph} `}
        </text>
        <text fg={t.text} selectable={false} wrapMode="none">
          {title}
        </text>
        {note != null && note !== '' ? (
          <box flexGrow={1} flexDirection="row" justifyContent="flex-end">
            {typeof note === 'string' ? (
              <text fg={t.textMuted} selectable={false} wrapMode="none">
                {note}
              </text>
            ) : (
              note
            )}
          </box>
        ) : null}
      </box>
      {rule ? <Rule width={width} /> : null}
      {children}
    </box>
  )
}

/** A titled block. The glyph is part of the title so the eye finds sections by shape. */
export function Panel({
  children,
  glyph,
  note,
  title,
}: {
  children: ReactNode
  glyph: string
  note?: string
  title: string
}) {
  const t = useTheme()
  return (
    <box flexDirection="column" flexShrink={0} paddingTop={1}>
      <box flexDirection="row">
        <text fg={t.primary} selectable={false} wrapMode="none">
          {`${glyph} `}
        </text>
        <text fg={t.text} selectable={false} wrapMode="none">
          {title}
        </text>
        {note != null && note !== '' ? (
          <box flexGrow={1} flexDirection="row" justifyContent="flex-end">
            <text fg={t.textMuted} selectable={false} wrapMode="none">
              {note}
            </text>
          </box>
        ) : null}
      </box>
      {children}
    </box>
  )
}

export function Muted({ children }: { children: string }) {
  const t = useTheme()
  return (
    <text fg={t.textMuted} selectable={false} wrapMode="none">
      {children}
    </text>
  )
}

/**
 * Side-by-side above `minWidth`, stacked below it.
 *
 * A terminal is not a page: at 80 columns two columns of tables collide, and a
 * collided table is worse than a tall one.
 */
export function Columns({
  children,
  gap = 3,
  minWidth = 92,
  width,
}: {
  children: [ReactNode, ReactNode]
  gap?: number
  minWidth?: number
  width: number
}) {
  if (width < minWidth) {
    return (
      <box flexDirection="column">
        {children[0]}
        {children[1]}
      </box>
    )
  }
  const columnWidth = Math.floor((width - gap) / 2)
  return (
    <box flexDirection="row" gap={gap}>
      <box flexDirection="column" width={columnWidth} flexShrink={0}>
        {children[0]}
      </box>
      <box flexDirection="column" width={columnWidth} flexShrink={0}>
        {children[1]}
      </box>
    </box>
  )
}

/**
 * Full block over light shade: the filled run and the track it sits in.
 *
 * Solid rather than segmented. A segmented mark — a repeated part-width block
 * like `▍` — puts a gap at the same place in every cell, and once several bars
 * are stacked those gaps line up into vertical stripes running the height of
 * the block. The stripes win the eye and the rows stop reading as bars.
 */
const BAR_FILL = '\u{2588}'
const BAR_TRACK = '\u{2591}'

export function Bar({
  color,
  max,
  segments = 24,
  value,
}: {
  color: RGBA | string
  max: number
  segments?: number
  value: number
}) {
  const t = useTheme()
  const filled =
    max <= 0
      ? 0
      : Math.min(segments, Math.max(value > 0 ? 1 : 0, Math.round((value / max) * segments)))

  return (
    <box flexDirection="row" flexShrink={0}>
      <text fg={color} selectable={false} wrapMode="none">
        {BAR_FILL.repeat(filled)}
      </text>
      <text fg={t.borderSubtle} selectable={false} wrapMode="none">
        {BAR_TRACK.repeat(segments - filled)}
      </text>
    </box>
  )
}

/**
 * A headline tile: coloured glyph, `Label ~ value`, and optionally a tick gauge
 * beneath. Three of these across the top of a page are its opening line.
 */
/**
 * A headline number in its slot on the row.
 *
 * Deliberately without a gauge. A bar has to be a fraction of something real —
 * a quota, a share of a total — and "today against your best day ever" is not
 * that: the record is not a target, so the bar would encode a comparison nobody
 * is making and read as progress toward nothing.
 */
export function StatTile({
  glyph,
  label,
  value,
  width,
}: {
  glyph: string
  label: string
  value: string
  /** The tile's slot on the row — equal slots are what line the tiles up. */
  width: number
}) {
  const t = useTheme()
  return (
    <box width={width} flexShrink={0} flexDirection="row">
      <text fg={t.primary} selectable={false} wrapMode="none">
        {`${glyph} `}
      </text>
      <text fg={t.textMuted} selectable={false} wrapMode="none">
        {`${label} `}
      </text>
      <text fg={t.text} selectable={false} wrapMode="none">
        {value}
      </text>
    </box>
  )
}

export function TileRow({ children }: { children: ReactNode }) {
  return (
    <box flexDirection="row" flexShrink={0}>
      {children}
    </box>
  )
}

const AXIS_WALL = '\u{2502}'
const AXIS_FOOT = '\u{2514}'
const AXIS_FLOOR = '\u{2500}'
/** The wall and the space between it and the first column. */
const AXIS_GUTTER = 2

/**
 * A column chart: an integer axis down the left, a rule under the columns, and
 * a caption beneath that.
 *
 * The L of wall and floor is what makes the columns read as measured against
 * something. Without it a column chart is a row of blocks floating on the
 * surface, and the eye has nothing to judge a height against. Both are drawn
 * one shade off the surface, so they frame the data without competing with it.
 */
export function VBarChart({
  caption,
  format,
  values,
}: {
  caption: string
  format?: (value: number) => string
  values: number[]
}) {
  const t = useTheme()
  const chart = buildChart(values, 8, format)
  const chartWidth = chart.bars[0]?.length ?? 0
  const axisWidth = chart.axis[0]?.length ?? 0
  const captionPad =
    axisWidth + AXIS_GUTTER + Math.max(0, Math.floor((chartWidth - caption.length) / 2))

  return (
    <box flexDirection="column" flexShrink={0}>
      {chart.bars.map((line, index) => (
        <box key={`${String(index)}:${line}`} flexDirection="row" flexShrink={0}>
          <text fg={t.textMuted} selectable={false} wrapMode="none">
            {chart.axis[index] ?? ''}
          </text>
          <text fg={t.borderSubtle} selectable={false} wrapMode="none">
            {`${AXIS_WALL} `}
          </text>
          <text fg={t.primary} selectable={false} wrapMode="none">
            {line}
          </text>
        </box>
      ))}
      <box flexDirection="row" flexShrink={0}>
        <text fg={t.borderSubtle} selectable={false} wrapMode="none">
          {`${' '.repeat(axisWidth)}${AXIS_FOOT}${AXIS_FLOOR.repeat(chartWidth + 1)}`}
        </text>
      </box>
      <box paddingLeft={captionPad} flexShrink={0}>
        <Muted>{caption}</Muted>
      </box>
    </box>
  )
}

/** The column every bar row's value ends on. */
const VALUE_WIDTH = 10
/**
 * Longest a bar is allowed to get, however wide the terminal.
 *
 * Past this the bar stops carrying information and starts carrying distance:
 * comparing two lengths gets harder as they grow, and on a wide terminal a row
 * that fills its column separates its own label from its own value.
 */
const BAR_MAX = 32

/**
 * A labelled magnitude bar, scaled against the largest value in its group.
 *
 * The same tick mark as the quota gauges, so one mark means one thing across
 * the screen: a proportion. It carries the value at its tip and nothing else —
 * a second number per row would be read against a different denominator than
 * the bar (share of the total, where the bar is scaled to the largest), which
 * is two scales in one row.
 */
export function BarRow({
  barWidth = 12,
  label,
  labelWidth = 14,
  max,
  value,
  valueText,
  width,
}: {
  barWidth?: number
  label: string
  labelWidth?: number
  max: number
  value: number
  valueText: string
  /** Fill exactly this many columns — the bar takes whatever the label and value leave. */
  width?: number
}) {
  const t = useTheme()
  const labels = width === undefined ? labelWidth : Math.max(6, Math.min(20, Math.round(width / 3)))
  const room = width === undefined ? barWidth : Math.max(4, width - labels - VALUE_WIDTH)
  const bars = Math.min(BAR_MAX, room)
  // Whatever the cap leaves over goes between the bar and its value, so the
  // values stay on the column's right edge and every row still ends together.
  const slack = room - bars

  return (
    <box flexDirection="row" flexShrink={0}>
      <box width={labels} flexShrink={0}>
        <text fg={t.textMuted} selectable={false} wrapMode="none">
          {truncate(label, labels - 1)}
        </text>
      </box>
      <Bar color={t.primary} max={max} segments={bars} value={value} />
      <text fg={t.text} selectable={false} wrapMode="none">
        {valueText.padStart(VALUE_WIDTH + slack)}
      </text>
    </box>
  )
}

/** Eight-step block ramp, tallest last — a column chart one row high. */
const SPARK = [
  '\u{2581}',
  '\u{2582}',
  '\u{2583}',
  '\u{2584}',
  '\u{2585}',
  '\u{2586}',
  '\u{2587}',
  '\u{2588}',
]

/**
 * Hourly distribution with its own axis.
 *
 * Two cells per hour so the ruler beneath can label every fourth one without the
 * digits running together.
 */
export function HourChart({ values }: { values: number[] }) {
  const t = useTheme()
  const max = Math.max(...values, 0)
  const bars = values
    .map((value) => {
      if (max <= 0 || value <= 0) return '  '
      const step = Math.min(SPARK.length - 1, Math.floor((value / max) * (SPARK.length - 1)))
      return (SPARK[step] ?? ' ').repeat(2)
    })
    .join('')

  const ruler = Array.from({ length: 24 }, (_, hour) =>
    hour % 4 === 0 ? String(hour).padStart(2, '0') : '  '
  ).join('')

  return (
    <box flexDirection="column" flexShrink={0}>
      <text fg={t.primary} selectable={false} wrapMode="none">
        {bars}
      </text>
      <text fg={t.textMuted} selectable={false} wrapMode="none">
        {ruler}
      </text>
    </box>
  )
}

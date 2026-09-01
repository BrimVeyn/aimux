import type { BorderSides, RGBA } from '@opentui/core'
import type { ReactNode } from 'react'

import { useTheme } from '../../theme'
import { truncate } from '../../truncate'
import { type BarShape, buildChart, buildRuler, strideOf } from './chart'

/**
 * The building blocks of a full-screen view — the stats pages, and the settings
 * screen, which is laid out against the same grid so the two read as one app.
 *
 * Every page is the same grid: a headline row of tiles, a rule, then sections
 * measured against the page's own width rather than against their content. A
 * section's note lands on the same column on every page, and that shared right
 * edge is what makes a screen read as one page instead of as blocks that happen
 * to sit near each other.
 *
 * There are no tables. A table earns its place when several unrelated numbers
 * have to be read against each other; a row of totals nobody compares is a
 * border drawn around four numbers, and those numbers sit better on the headline
 * row, in a fact grid, or in the chart that shows how they got there.
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

export function Muted({ children }: { children: string }) {
  const t = useTheme()
  return (
    <text fg={t.textMuted} selectable={false} wrapMode="none">
      {children}
    </text>
  )
}

/**
 * The page's grid: one padding column either side, two content columns, and a
 * three-cell gutter carrying the vertical rule.
 *
 * Private on purpose. Every page gets its padding from `StatsPage` and its
 * widths from `pageLayout`, so there is one place that knows this number and no
 * way for a page to disagree with the others about it.
 */
const PAGE_PAD = 1
/** The spacer, the rule, and the right column's own padding. */
const GUTTER = 3
/** Below this the two columns collide, and a collided section is worse than a tall page. */
const TWO_COLUMN_MIN = 92

export interface Split {
  leftWidth: number
  rightWidth: number
  twoUp: boolean
}

/** The two content columns of `usable`, or one column's worth twice over when narrow. */
function splitWidths(usable: number): Split {
  const twoUp = usable >= TWO_COLUMN_MIN
  const leftWidth = twoUp ? Math.floor((usable - GUTTER) / 2) : usable
  return { leftWidth, rightWidth: twoUp ? usable - GUTTER - leftWidth : usable, twoUp }
}

export interface PageLayout {
  split: Split
  /** Columns inside the page's own padding — what every section is measured against. */
  usable: number
}

/**
 * The widths a page lays itself out against.
 *
 * One function rather than three copies of the same three lines: the pages only
 * read as one screen for as long as they agree on this arithmetic, and three
 * copies is three chances to disagree.
 */
export function pageLayout(width: number): PageLayout {
  const usable = Math.max(24, width - PAGE_PAD * 2)
  return { split: splitWidths(usable), usable }
}

/** Module scope: a fresh array every render would repaint the divider each frame. */
const BORDER_LEFT: BorderSides[] = ['left']

/**
 * Two stacks of sections side by side, divided by a rule.
 *
 * The rule is drawn as a border rather than as a guessed number of rows, so it
 * runs the full height of whichever column ends up taller.
 */
export function TwoColumn({ children, split }: { children: [ReactNode, ReactNode]; split: Split }) {
  const t = useTheme()
  if (!split.twoUp) {
    return (
      <box flexDirection="column" flexShrink={0}>
        {children[0]}
        {children[1]}
      </box>
    )
  }
  return (
    <box flexDirection="row" flexShrink={0}>
      <box width={split.leftWidth} flexDirection="column" flexShrink={0}>
        {children[0]}
      </box>
      <box width={1} flexShrink={0} />
      <box
        border={BORDER_LEFT}
        borderColor={t.borderSubtle}
        paddingLeft={1}
        width={split.rightWidth + 2}
        flexDirection="column"
        flexShrink={0}
      >
        {children[1]}
      </box>
    </box>
  )
}

/** Widest a fact's label is allowed to get before the value starts drifting away from it. */
const FACT_LABEL_MAX = 20

/**
 * Label/value pairs in columns, for the counts a chart cannot carry.
 *
 * Heterogeneous totals — workspaces, tabs, daemon restarts — share no scale, so
 * a bar between them would encode a comparison nobody is making. What they need
 * is to be readable side by side, which is a column of labels and a column of
 * numbers and nothing else.
 */
export function FactGrid({
  columns = 2,
  facts,
  width,
}: {
  columns?: number
  facts: [string, string][]
  width: number
}) {
  const t = useTheme()
  const perColumn = Math.ceil(facts.length / columns)
  const columnWidth = Math.floor(width / columns)
  const labelWidth = Math.max(8, Math.min(FACT_LABEL_MAX, Math.floor(columnWidth / 2)))

  return (
    <box flexDirection="row" flexShrink={0}>
      {Array.from({ length: columns }, (_, column) => (
        <box
          key={column}
          width={columnWidth}
          flexDirection="column"
          flexShrink={0}
          overflow="hidden"
        >
          {facts.slice(column * perColumn, (column + 1) * perColumn).map(([label, value]) => (
            <box key={label} flexDirection="row" flexShrink={0}>
              <box width={labelWidth} flexShrink={0}>
                <text fg={t.textMuted} selectable={false} wrapMode="none">
                  {truncate(label, labelWidth - 1)}
                </text>
              </box>
              <text fg={t.text} selectable={false} wrapMode="none">
                {truncate(value, columnWidth - labelWidth)}
              </text>
            </box>
          ))}
        </box>
      ))}
    </box>
  )
}

export interface StatRecord {
  label: string
  value: string
  /** Blank for a record no single day owns, like a streak or a lifetime total. */
  when: string
}

/**
 * Drops the records that were not set.
 *
 * A page lists every record it could hold and marks the ones with nothing behind
 * them `null`, rather than pushing into an array through a closure: what the
 * section can contain then reads as one list instead of as a run of `if`s.
 */
export function recordsOf(entries: (StatRecord | null)[]): StatRecord[] {
  return entries.filter((entry): entry is StatRecord => entry !== null)
}

/**
 * One record: what it is, what it was, and when.
 *
 * The same three-part geometry as a bar row — label on the left, the number in
 * the middle, the page's right edge on the right — so a records section lines up
 * with the bars above it instead of reading as a table someone pasted in.
 */
function RecordRow({
  label,
  value,
  when,
  width,
}: {
  label: string
  value: string
  when: string
  width: number
}) {
  const t = useTheme()
  const labels = Math.max(10, Math.min(24, Math.round(width / 3)))

  return (
    <box width={width} flexDirection="row" flexShrink={0}>
      <box width={labels} flexShrink={0}>
        <text fg={t.textMuted} selectable={false} wrapMode="none">
          {truncate(label, labels - 1)}
        </text>
      </box>
      <text fg={t.text} selectable={false} wrapMode="none">
        {value}
      </text>
      {when === '' ? null : (
        <box flexGrow={1} flexDirection="row" justifyContent="flex-end">
          <text fg={t.textMuted} selectable={false} wrapMode="none">
            {when}
          </text>
        </box>
      )}
    </box>
  )
}

/**
 * A solid bar half a cell tall, resting on a hairline track.
 *
 * Half height, not full: a full block fills its cell top to bottom, so stacked
 * rows touch and seven bars merge into one shape with steps in it — you can see
 * the outline of the data but not where one bar ends and the next begins. The
 * empty top half of each cell is the gap between rows, for free.
 *
 * Solid rather than segmented, though. A repeated part-*width* block like `▍`
 * puts a gap at the same place in every cell, and stacked those gaps line up
 * into vertical stripes that win the eye.
 */
const BAR_FILL = '\u{2584}'
const BAR_TRACK = '\u{2581}'

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

  // Each half is dropped when it is empty rather than rendered as `''`: opentui
  // floors a text node at one column (`Math.max(1, widthColsMax)`), so an empty
  // node is a column wide. A full bar would push its value one column right and
  // off the end of the row, and an empty one would indent its own track.
  return (
    <box flexDirection="row" flexShrink={0}>
      {filled === 0 ? null : (
        <text fg={color} selectable={false} wrapMode="none">
          {BAR_FILL.repeat(filled)}
        </text>
      )}
      {filled >= segments ? null : (
        <text fg={t.borderSubtle} selectable={false} wrapMode="none">
          {BAR_TRACK.repeat(segments - filled)}
        </text>
      )}
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
function StatTile({
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

export interface PageTile {
  glyph: string
  label: string
  value: string
}

/**
 * The headline row: equal slots across the page's width, the last one taking
 * whatever the division left over so the row ends on the page's right edge
 * rather than a column or two short.
 */
export function TileRow({ tiles, usable }: { tiles: PageTile[]; usable: number }) {
  const tileWidth = Math.floor(usable / Math.max(1, tiles.length))
  return (
    <box flexDirection="row" flexShrink={0}>
      {tiles.map((tile, index) => (
        <StatTile
          key={tile.label}
          glyph={tile.glyph}
          label={tile.label}
          value={tile.value}
          width={index === tiles.length - 1 ? usable - tileWidth * (tiles.length - 1) : tileWidth}
        />
      ))}
    </box>
  )
}

/**
 * Every page's frame: the headline row, the rule under it, and the padding they
 * both sit in.
 *
 * The pages differ in what they measure and agree on how they are laid out, so
 * the layout lives here. Left to each page, the agreement held only for as long
 * as nobody edited one of them — which is how the three drifted apart the first
 * time.
 */
export function StatsPage({
  children,
  tiles,
  usable,
}: {
  children: ReactNode
  tiles: PageTile[]
  usable: number
}) {
  return (
    <box flexDirection="column" paddingLeft={PAGE_PAD} paddingRight={PAGE_PAD}>
      <TileRow tiles={tiles} usable={usable} />
      <box paddingTop={1} paddingBottom={1} flexShrink={0}>
        <Rule width={usable} />
      </box>
      {children}
    </box>
  )
}

/** A whole page that has nothing to show yet, in the page's own padding. */
export function PageNotice({ children }: { children: string }) {
  return (
    <box paddingLeft={PAGE_PAD} paddingRight={PAGE_PAD}>
      <Muted>{children}</Muted>
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
  bar,
  caption,
  format,
  height = 10,
  labels,
  values,
}: {
  /** Bar width and gap. Defaults to the two-wide, one-gap day column. */
  bar?: BarShape
  caption?: string
  format?: (value: number) => string
  height?: number
  /** One per bar, blank where a bar goes unlabelled. */
  labels?: string[]
  values: number[]
}) {
  const t = useTheme()
  const chart = buildChart(values, height, format, bar)
  const chartWidth = chart.bars[0]?.length ?? 0
  const axisWidth = chart.axis[0]?.length ?? 0
  const captionPad =
    axisWidth + AXIS_GUTTER + Math.max(0, Math.floor((chartWidth - (caption?.length ?? 0)) / 2))

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
      {labels === undefined ? null : (
        <box paddingLeft={axisWidth + AXIS_GUTTER} flexShrink={0}>
          <Muted>{buildRuler(labels, strideOf(bar))}</Muted>
        </box>
      )}
      {caption === undefined ? null : (
        <box paddingLeft={captionPad} flexShrink={0}>
          <Muted>{caption}</Muted>
        </box>
      )}
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

/**
 * The records a page closes on.
 *
 * A records page of its own was mostly empty and every row on it belonged to
 * data another page already showed, so each page keeps its own — which only
 * works if they all draw it the same way.
 */
export function RecordsSection({
  empty,
  records,
  width,
}: {
  empty: string
  records: StatRecord[]
  width: number
}) {
  return (
    <Section
      glyph={GLYPH.records}
      title="Records"
      note={records.length === 0 ? '' : `${records.length} set`}
      width={width}
    >
      {records.length === 0 ? (
        <Muted>{empty}</Muted>
      ) : (
        records.map((record) => (
          <RecordRow
            key={record.label}
            label={record.label}
            value={record.value}
            when={record.when}
            width={width}
          />
        ))
      )}
    </Section>
  )
}

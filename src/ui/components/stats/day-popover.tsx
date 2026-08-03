import type { UsageDay } from '../../../services/usage-history/store'

import { dayCost, formatUsd } from '../../../services/usage-history/cost'
import { formatCompact } from '../../format-number'
import { useTheme } from '../../theme'
import { truncate } from '../../truncate'
import { formatClock, formatCount, formatDuration } from './format'

/**
 * Everything recorded about one day, for the calendar's click target.
 *
 * The heatmap encodes a single number as a shade; this is where the rest of the
 * day lives. Rows that have nothing to say are omitted rather than shown as a
 * dash, so the box is as tall as the day was interesting.
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** `2026-03-14` as `Saturday 14 March` — the popover has room for the long form. */
function longDate(key: string): string {
  const [year, month, day] = key.split('-').map(Number)
  const date = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1)
  return `${WEEKDAYS[date.getDay()] ?? ''} ${day ?? ''} ${MONTHS[(month ?? 1) - 1] ?? ''}`
}

/** The largest entry of a `name -> number` map, with its share of the total. */
function top(counts: Record<string, number>): { name: string; share: number } | null {
  let total = 0
  let best: [string, number] | null = null
  for (const entry of Object.entries(counts)) {
    total += entry[1]
    if (best === null || entry[1] > best[1]) best = entry
  }
  if (best === null || total <= 0) return null
  return { name: best[0], share: Math.round((best[1] / total) * 100) }
}

/** The last two path segments — `Documents/aimux` says more than `aimux`. */
function shortenPath(path: string): string {
  return path
    .split('/')
    .filter((part) => part !== '')
    .slice(-2)
    .join('/')
}

/** First prompt to last, and the time actually inside a session — not their gap. */
function spanOf(day: UsageDay): string {
  let first = Number.POSITIVE_INFINITY
  let last = 0
  let ms = 0
  for (const session of Object.values(day.sessions)) {
    first = Math.min(first, session.first)
    last = Math.max(last, session.last)
    ms += Math.max(0, session.last - session.first)
  }
  if (!Number.isFinite(first)) return ''
  const clockOf = (epoch: number): string => {
    const date = new Date(epoch)
    return formatClock(date.getHours() * 60 + date.getMinutes())
  }
  return `${clockOf(first)} \u{2192} ${clockOf(last)} \u{00B7} ${formatDuration(ms)}`
}

export interface DayDetails {
  rows: [string, string][]
  title: string
}

export function dayDetails(key: string, day: UsageDay | undefined): DayDetails | null {
  if (day === undefined) return null

  const rows: [string, string][] = []
  const add = (label: string, value: string): void => {
    if (value !== '') rows.push([label, value])
  }

  add('Prompts', day.prompts > 0 ? formatCount(day.prompts) : '')

  const busiest = day.hours.indexOf(Math.max(...day.hours, 0))
  if (day.hours.length > 0 && (day.hours[busiest] ?? 0) > 0) {
    add(
      'Busiest hour',
      `${formatClock(busiest * 60)} \u{00B7} ${formatCount(day.hours[busiest] ?? 0)}`
    )
  }
  add('Active', spanOf(day))

  const sessions = Object.keys(day.sessions).length
  add('Sessions', sessions > 0 ? formatCount(sessions) : '')
  if (day.promptChars.count > 0) {
    add('Prompt length', `${Math.round(day.promptChars.sum / day.promptChars.count)} chars average`)
  }
  if (day.turnMs.count > 0) {
    add('Average turn', formatDuration(day.turnMs.sum / day.turnMs.count))
  }

  if (day.tokens.total > 0) {
    add('Tokens', formatCompact(day.tokens.total))
    add(
      'In / out',
      `${formatCompact(day.tokens.input)} \u{00B7} ${formatCompact(day.tokens.output)}`
    )
    add('Cache read', formatCompact(day.tokens.cacheRead))
    add('Cost', `${formatUsd(dayCost(day).total)} estimated`)
  }

  const model = top(day.models)
  if (model !== null)
    add('Top model', `${model.name.replace(/^claude-/, '')} \u{00B7} ${model.share}%`)
  const project = top(day.projects)
  if (project !== null)
    add('Top project', `${shortenPath(project.name)} \u{00B7} ${project.share}%`)
  const branch = top(day.branches)
  if (branch !== null) add('Top branch', `${branch.name} \u{00B7} ${branch.share}%`)

  // A day with nothing recorded gets no popover at all rather than an empty box.
  return rows.length === 0 ? null : { rows, title: longDate(key) }
}

/**
 * Two columns, because the popover floats over the calendar it describes.
 *
 * A single column of thirteen rows would stand taller than the whole grid, so
 * wherever it were pinned it would cover the month the reader is looking at.
 * Half as tall and twice as wide fits inside the calendar's own height.
 */
const LABEL_WIDTH = 13
const VALUE_WIDTH = 21
const COLUMN_WIDTH = LABEL_WIDTH + VALUE_WIDTH
/** Border and padding, both sides. */
const CHROME = 4

/** What the popover will measure, so the caller can place it before rendering. */
export function popoverSize(details: DayDetails): { height: number; width: number } {
  const perColumn = Math.ceil(details.rows.length / 2)
  return { height: perColumn + 2, width: COLUMN_WIDTH * 2 + CHROME }
}

export interface PopoverPlacement {
  left: number
  top: number
}

/**
 * Where the popover sits relative to the grid it floats over.
 *
 * It opens away from the nearest edge — right of a cell in the left half, left
 * of one in the right half, and the same above and below — so it grows into the
 * room there is and tends to leave the clicked cell uncovered. Whatever is left
 * over is clamped inside the grid: a popover half off the pane is worse than
 * one sitting on the wrong side.
 */
export function placePopover(anchor: {
  cellX: number
  cellY: number
  gridHeight: number
  gridWidth: number
  size: { height: number; width: number }
}): PopoverPlacement {
  const { cellX, cellY, gridHeight, gridWidth, size } = anchor
  const clamp = (value: number, max: number): number => Math.max(0, Math.min(value, max))
  const leftward = cellX * 2 > gridWidth
  const upward = cellY * 2 > gridHeight

  return {
    left: clamp(leftward ? cellX - size.width + 1 : cellX, gridWidth - size.width),
    top: clamp(upward ? cellY - size.height : cellY + 1, gridHeight - size.height),
  }
}

function Column({ rows }: { rows: [string, string][] }) {
  const t = useTheme()
  return (
    <box width={COLUMN_WIDTH} flexDirection="column" flexShrink={0}>
      {rows.map(([label, value]) => (
        <box key={`${label}:${value}`} flexDirection="row" flexShrink={0}>
          <box width={LABEL_WIDTH} flexShrink={0}>
            <text fg={t.textMuted} selectable={false} wrapMode="none">
              {label}
            </text>
          </box>
          <text fg={t.text} selectable={false} wrapMode="none">
            {truncate(value, VALUE_WIDTH)}
          </text>
        </box>
      ))}
    </box>
  )
}

/** The date rides the border as a title, so no row has to double as a heading. */
export function DayPopover({ details }: { details: DayDetails }) {
  const t = useTheme()
  const perColumn = Math.ceil(details.rows.length / 2)
  const size = popoverSize(details)

  return (
    <box
      border
      borderStyle="rounded"
      borderColor={t.borderActive}
      backgroundColor={t.backgroundPanel}
      title={details.title}
      paddingLeft={1}
      paddingRight={1}
      width={size.width}
      flexDirection="row"
      flexShrink={0}
    >
      <Column rows={details.rows.slice(0, perColumn)} />
      <Column rows={details.rows.slice(perColumn)} />
    </box>
  )
}

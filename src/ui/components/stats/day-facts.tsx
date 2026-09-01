import type { UsageDay } from '../../../services/usage-history/store'

import { dayCost, formatUsd } from '../../../services/usage-history/cost'
import { formatCompact } from '../../format-number'
import { useTheme } from '../../theme'
import { truncate } from '../../truncate'
import { formatClock, formatCount, formatDuration, shortenPath } from './format'

/**
 * Everything recorded about one day, for the readout under the calendar.
 *
 * The heatmap encodes a single number as a shade; this is where the rest of the
 * day lives. Rows that have nothing to say are omitted rather than shown as a
 * dash — an old day whose transcripts have been pruned says what it still knows
 * and nothing more.
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

/**
 * A day always has a title, even with nothing behind it.
 *
 * The readout follows the pointer, so a day the calendar draws but never
 * recorded — a quiet one inside the covered range — has to say so under its own
 * date rather than blank the slot as the pointer crosses it.
 */
export function dayDetails(key: string, day: UsageDay | undefined): DayDetails {
  if (day === undefined) return { rows: [], title: longDate(key) }

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

  return { rows, title: longDate(key) }
}

const SEPARATOR = ' \u{00B7} '

/**
 * The day's facts as running lines rather than a table.
 *
 * The page already reads this way — the calendar's own summary and the token
 * chart's caption are both `a · b · c` — and a readout that changes on every
 * mouse move must not redraw as a block of shifting columns. Fourteen labelled
 * numbers wrapped into three lines settle into the same shape whichever day
 * they describe.
 */
export function packFacts(rows: [string, string][], width: number, maxLines = 3): string[] {
  const lines: string[] = []
  let line = ''
  for (const [label, value] of rows) {
    const fact = `${label} ${value}`
    if (line === '') {
      line = fact
      continue
    }
    // ponytail: the last line takes the remainder and truncates rather than
    // dropping facts. Three lines hold a full day past about 90 columns, and
    // the calendar itself needs more than that to be worth reading.
    if (line.length + SEPARATOR.length + fact.length > width && lines.length < maxLines - 1) {
      lines.push(line)
      line = fact
      continue
    }
    line += SEPARATOR + fact
  }
  if (line !== '') lines.push(line)
  return lines
}

/** Rows reserved under the calendar: the date, then the facts. */
export const FACT_LINES = 3
export const DAY_FACTS_HEIGHT = 1 + FACT_LINES

/**
 * The readout under the calendar, for when there is no room beside it.
 *
 * Running lines rather than columns: at this width a label/value grid would be
 * mostly gap, and the height is fixed so nothing below shifts as the pointer
 * crosses the year.
 */
export function DayFacts({ details, width }: { details: DayDetails; width: number }) {
  const t = useTheme()
  const lines = details.rows.length === 0 ? ['nothing recorded'] : packFacts(details.rows, width)

  return (
    <box height={DAY_FACTS_HEIGHT} flexDirection="column" flexShrink={0}>
      <text fg={t.text} selectable={false} wrapMode="none">
        {details.title}
      </text>
      {lines.map((line) => (
        <text key={line} fg={t.textMuted} selectable={false} wrapMode="none">
          {truncate(line, width)}
        </text>
      ))}
    </box>
  )
}

/**
 * Two columns, sized so the panel is no taller than the calendar it stands
 * beside — seven rows of facts inside a border is nine, against the grid's
 * eleven. One column would be fourteen rows and would set the height of the
 * whole section.
 */
const LABEL_WIDTH = 14
const VALUE_WIDTH = 22
/** Between the two columns: the longest value fills its width exactly. */
const COLUMN_GAP = 2
const COLUMN_WIDTH = LABEL_WIDTH + VALUE_WIDTH + COLUMN_GAP
/** Border and padding, both sides. */
const CHROME = 4
export const PANEL_WIDTH = COLUMN_WIDTH * 2 + CHROME
/** The calendar's height, so the panel's own rows can be padded up to it. */
const PANEL_ROWS = 7

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

/**
 * The readout beside the calendar.
 *
 * Beside rather than below or over it: the calendar is bounded by what has been
 * recorded, so it rarely fills the pane, and the room to its right was going
 * spare. Nothing is covered, nothing has to be dismissed, and the labels line
 * up in a column instead of running together as prose.
 *
 * The date rides the border as a title, so no row has to double as a heading.
 */
export function DayPanel({ details }: { details: DayDetails }) {
  const t = useTheme()
  // Padded to a constant height: a bare day and a full one must not resize the
  // panel as the pointer moves between them.
  const rows: [string, string][] =
    details.rows.length === 0 ? [['', 'nothing recorded']] : details.rows
  const perColumn = Math.max(PANEL_ROWS, Math.ceil(rows.length / 2))

  return (
    <box
      border
      borderStyle="rounded"
      borderColor={t.border}
      title={details.title}
      paddingLeft={1}
      paddingRight={1}
      width={PANEL_WIDTH}
      height={PANEL_ROWS + 2}
      flexDirection="row"
      flexShrink={0}
    >
      <Column rows={rows.slice(0, perColumn)} />
      <Column rows={rows.slice(perColumn)} />
    </box>
  )
}

import { parseColor, RGBA } from '@opentui/core'

import { daysBetween, parseDayKey } from './insights'
import { emptyTokens, localDay, type UsageDays, type UsageTokens } from './store'

/** Pure shaping of stored usage days into what the History page renders. */

export interface HeatmapCell {
  /** 'YYYY-MM-DD', or '' for a cell outside the covered range. */
  day: string
  level: number
  value: number
}

/** Quartiles of the non-empty days: a linear `value / max` ramp lets one outlier flatten the year to level 1. */
export function cutPoints(values: number[]): [number, number, number] {
  const sorted = values.filter((value) => value > 0).sort((left, right) => left - right)
  const at = (quantile: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))] ?? 0
  return [at(0.25), at(0.5), at(0.75)]
}

function levelOf(value: number, cuts: [number, number, number]): number {
  if (value <= 0) return 0
  if (value <= cuts[0]) return 1
  if (value <= cuts[1]) return 2
  if (value <= cuts[2]) return 3
  return 4
}

/** Week columns needed to cover what is recorded, so the grid does not open on empty months. */
export function coveredWeeks(days: UsageDays, today: Date, maxWeeks: number): number {
  const dates = Object.keys(days).sort()
  const first = dates[0]
  if (first === undefined) return Math.min(maxWeeks, 12)
  const elapsed = daysBetween(parseDayKey(first), today)
  return Math.max(4, Math.min(maxWeeks, Math.ceil((elapsed + 1) / 7) + 1))
}

/** 7 rows (Sunday first) by `weeks` columns, oldest left. Cells after today come back empty. */
export function buildHeatmap(
  counts: Record<string, number>,
  weeks: number,
  today: Date
): HeatmapCell[][] {
  const cuts = cutPoints(Object.values(counts))

  // Anchored on the Saturday closing this week, so the last column is the week
  // in progress. Weeks run Sunday to Saturday, which is what the row labels say.
  const end = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() + (6 - today.getDay())
  )
  // Calendar arithmetic, never `getTime() - n * DAY_MS`: across a DST change the
  // millisecond form lands on 23:00 the day before and rotates every row by one.
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (weeks * 7 - 1))
  const todayKey = localDay(today)

  const rows: HeatmapCell[][] = []
  for (let row = 0; row < 7; row++) {
    const cells: HeatmapCell[] = []
    for (let column = 0; column < weeks; column++) {
      const date = new Date(
        start.getFullYear(),
        start.getMonth(),
        start.getDate() + column * 7 + row
      )
      const key = localDay(date)
      if (key > todayKey) {
        cells.push({ day: '', level: 0, value: 0 })
        continue
      }
      const value = counts[key] ?? 0
      cells.push({ day: key, level: levelOf(value, cuts), value })
    }
    rows.push(cells)
  }
  return rows
}

export interface MonthLabel {
  /** 0-based calendar month, so the caller can colour the label like its cells. */
  month: number
  name: string
  /** Cell offset from the left edge of the grid where the name starts. */
  offset: number
}

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/**
 * One label per month present in the grid, centred over the columns that month
 * occupies. `cellWidth` mirrors the grid's own so the offsets are in the same
 * units the caller pads with.
 *
 * A column belongs to the month of its first recorded day: a week straddling a
 * month boundary has to pick one, and the earlier one is where the column
 * starts on screen.
 */
export function monthLabels(grid: HeatmapCell[][], weeks: number, cellWidth: number): MonthLabel[] {
  const spans: { end: number; month: number; start: number }[] = []
  for (let column = 0; column < weeks; column++) {
    const day = grid.map((row) => row[column]?.day ?? '').find((key) => key !== '')
    if (day === undefined) continue
    const month = Number(day.slice(5, 7)) - 1
    const last = spans.at(-1)
    if (last !== undefined && last.month === month) last.end = column
    else spans.push({ end: column, month, start: column })
  }

  const labels: MonthLabel[] = []
  let usedUpTo = 0
  for (const span of spans) {
    const name = MONTH_NAMES[span.month] ?? ''
    const width = (span.end - span.start + 1) * cellWidth
    const centred = span.start * cellWidth + Math.floor((width - name.length) / 2)
    // Never behind the previous label: a narrow leading month would otherwise
    // centre its name on top of the one before it.
    const offset = Math.max(usedUpTo, centred)
    if (offset + name.length > weeks * cellWidth) continue
    labels.push({ month: span.month, name, offset })
    usedUpTo = offset + name.length + 1
  }
  return labels
}

export function promptCounts(days: UsageDays): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const [date, day] of Object.entries(days)) counts[date] = day.prompts
  return counts
}

export interface UsageSummary {
  branches: [string, number][]
  /** Denominator for branch shares — branch-less entries are excluded. */
  branchTotal: number
  models: [string, number][]
  modelTotal: number
  peakPrompts: number
  promptDays: number
  /** Days carrying token data — a shorter span than `promptDays` once pruning starts. */
  tokenDays: number
  tokens: UsageTokens
  totalPrompts: number
}

function rank(totals: Record<string, number>): { entries: [string, number][]; total: number } {
  const entries = Object.entries(totals)
  entries.sort((left, right) => right[1] - left[1])
  let total = 0
  for (const [, value] of entries) total += value
  return { entries, total }
}

export function summarizeDays(days: UsageDays, limit = 6): UsageSummary {
  const tokens = emptyTokens()
  const models: Record<string, number> = {}
  const branches: Record<string, number> = {}
  let peakPrompts = 0
  let promptDays = 0
  let tokenDays = 0
  let totalPrompts = 0

  for (const day of Object.values(days)) {
    tokens.cacheRead += day.tokens.cacheRead
    tokens.cacheWrite += day.tokens.cacheWrite
    tokens.input += day.tokens.input
    tokens.output += day.tokens.output
    tokens.total += day.tokens.total

    if (day.tokens.total > 0) tokenDays += 1
    if (day.prompts > 0) {
      promptDays += 1
      totalPrompts += day.prompts
      if (day.prompts > peakPrompts) peakPrompts = day.prompts
    }

    for (const [model, count] of Object.entries(day.models)) {
      models[model] = (models[model] ?? 0) + count
    }
    for (const [branch, count] of Object.entries(day.branches)) {
      branches[branch] = (branches[branch] ?? 0) + count
    }
  }

  const rankedModels = rank(models)
  const rankedBranches = rank(branches)

  return {
    branches: rankedBranches.entries.slice(0, limit),
    branchTotal: rankedBranches.total,
    models: rankedModels.entries.slice(0, limit),
    modelTotal: rankedModels.total,
    peakPrompts,
    promptDays,
    tokenDays,
    tokens,
    totalPrompts,
  }
}

/** Blends two theme colours: the palette is flat, so the five-step ramp has to be derived per theme. */
export function mixColor(from: string, to: string, ratio: number): RGBA {
  const start = parseColor(from)
  const end = parseColor(to)
  // A transparent anchor would fade the whole ramp out; keep the target instead.
  if (start.a === 0) return end
  return RGBA.fromValues(
    start.r + (end.r - start.r) * ratio,
    start.g + (end.g - start.g) * ratio,
    start.b + (end.b - start.b) * ratio,
    1
  )
}

import {
  HOURS_IN_DAY,
  localDay,
  type UsageDay,
  type UsageDays,
  type UsageMean,
  type UsageSession,
} from './store'

/**
 * Derivations over the stored days, for the Activity / Projects / Records pages.
 *
 * Separate from `stats.ts`, which shapes the heatmap grid: that file is calendar
 * geometry, this one is arithmetic over what the days contain. Everything here is
 * pure and takes `UsageDays`, so it is testable without touching disk.
 *
 * Days recorded before the v2 rollup carry the new fields as empty rather than
 * zeroed. Every function below reports a `days` count alongside its result so a
 * page can say "no data" instead of rendering an empty span as a measurement.
 */

const MINUTES_IN_DAY = 24 * 60
const MS_PER_DAY = 86_400_000

export function parseDayKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1)
}

/** Whole days apart, via `Date.UTC` on the calendar parts — a DST span is not a whole number of 24h periods. */
export function daysBetween(from: Date, to: Date): number {
  const utcOf = (date: Date): number =>
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  return Math.round((utcOf(to) - utcOf(from)) / MS_PER_DAY)
}

/**
 * One value per calendar day for the `count` days ending today, oldest first —
 * the series a daily bar chart draws. Unrecorded days are zero, not skipped:
 * the x-axis is time, and time does not pause on a day off.
 */
export function lastDays(
  days: UsageDays,
  count: number,
  today: Date,
  of: (day: UsageDay) => number
): number[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(today)
    date.setDate(date.getDate() - (count - 1 - index))
    const day = days[localDay(date)]
    return day === undefined ? 0 : of(day)
  })
}

function promptDayKeys(days: UsageDays): string[] {
  return Object.entries(days)
    .filter(([, day]) => day.prompts > 0)
    .map(([key]) => key)
    .sort()
}

// ─── Activity ────────────────────────────────────────────────────────────────

export interface StreakInfo {
  current: number
  longest: number
  /** Largest run of consecutive prompt-less days between two active ones. */
  longestGapDays: number
}

/**
 * A streak that ends yesterday is still current: the day is not over, and
 * breaking it at midnight would report every morning as a reset.
 */
export function streaks(days: UsageDays, today: Date): StreakInfo {
  const keys = promptDayKeys(days)
  if (keys.length === 0) return { current: 0, longest: 0, longestGapDays: 0 }

  let longest = 1
  let longestGapDays = 0
  let run = 1
  for (let index = 1; index < keys.length; index++) {
    const gap = daysBetween(parseDayKey(keys[index - 1] ?? ''), parseDayKey(keys[index] ?? ''))
    if (gap === 1) {
      run += 1
      if (run > longest) longest = run
    } else {
      if (gap - 1 > longestGapDays) longestGapDays = gap - 1
      run = 1
    }
  }

  const last = parseDayKey(keys.at(-1) ?? '')
  const sinceLast = daysBetween(last, today)
  // Only a run that reaches today or yesterday is still going. `run` is the
  // length of the final run because the loop never resets it after the last gap.
  const current = sinceLast <= 1 ? run : 0

  return { current, longest, longestGapDays }
}

/** 24 buckets of prompts, summed across every day. */
export function hourTotals(days: UsageDays): number[] {
  const totals = Array.from({ length: HOURS_IN_DAY }, () => 0)
  for (const day of Object.values(days)) {
    for (let hour = 0; hour < HOURS_IN_DAY; hour++) {
      totals[hour] = (totals[hour] ?? 0) + (day.hours[hour] ?? 0)
    }
  }
  return totals
}

/** 7 buckets of prompts, Monday first — matching the heatmap's row order. */
export function weekdayTotals(days: UsageDays): number[] {
  const totals = Array.from({ length: 7 }, () => 0)
  for (const [key, day] of Object.entries(days)) {
    if (day.prompts === 0) continue
    const mondayIndex = (parseDayKey(key).getDay() + 6) % 7
    totals[mondayIndex] = (totals[mondayIndex] ?? 0) + day.prompts
  }
  return totals
}

export interface TypicalDay {
  /** Days that contributed — 0 means the pages must not render the times. */
  days: number
  endMinutes: number
  startMinutes: number
}

/**
 * The average local clock time of the day's first and last prompt.
 *
 * Read off the session spans rather than the hour buckets: those place the edges
 * of a day to the hour, and `09:00` where the truth is `09:12` reads as a
 * rounded guess rather than a measurement.
 */
export function typicalDay(days: UsageDays): TypicalDay {
  let startSum = 0
  let endSum = 0
  let counted = 0

  for (const day of Object.values(days)) {
    let first = Infinity
    let last = -Infinity
    for (const session of Object.values(day.sessions)) {
      if (session.first < first) first = session.first
      if (session.last > last) last = session.last
    }
    if (!Number.isFinite(first) || !Number.isFinite(last)) continue

    const firstAt = new Date(first)
    const lastAt = new Date(last)
    startSum += firstAt.getHours() * 60 + firstAt.getMinutes()
    endSum += lastAt.getHours() * 60 + lastAt.getMinutes()
    counted += 1
  }

  if (counted === 0) return { days: 0, endMinutes: 0, startMinutes: 0 }
  return {
    days: counted,
    endMinutes: Math.round(endSum / counted) % MINUTES_IN_DAY,
    startMinutes: Math.round(startSum / counted) % MINUTES_IN_DAY,
  }
}

// ─── Projects and sessions ───────────────────────────────────────────────────

export interface Ranked {
  entries: [string, number][]
  total: number
}

export function projectTotals(days: UsageDays, limit = 6): Ranked {
  const totals: Record<string, number> = {}
  for (const day of Object.values(days)) {
    for (const [path, count] of Object.entries(day.projects)) {
      totals[path] = (totals[path] ?? 0) + count
    }
  }
  const entries = Object.entries(totals).sort((left, right) => right[1] - left[1])
  let total = 0
  for (const [, value] of entries) total += value
  return { entries: entries.slice(0, limit), total }
}

export interface SessionStats {
  count: number
  /** Day key of the longest session, for the Records page. */
  longestDay: string
  longestMs: number
  medianMs: number
  /** Days that carried any session, the denominator for sessions-per-day. */
  days: number
  /** Sessions holding exactly one prompt — they last ~0 and would otherwise look like a bug. */
  singlePrompt: number
}

export function sessionStats(days: UsageDays): SessionStats {
  const durations: number[] = []
  let count = 0
  let longestMs = 0
  let longestDay = ''
  let dayCount = 0
  let singlePrompt = 0

  for (const [key, day] of Object.entries(days)) {
    const sessions: UsageSession[] = Object.values(day.sessions)
    if (sessions.length === 0) continue
    dayCount += 1
    for (const session of sessions) {
      count += 1
      if (session.prompts <= 1) singlePrompt += 1
      const duration = Math.max(0, session.last - session.first)
      durations.push(duration)
      if (duration > longestMs) {
        longestMs = duration
        longestDay = key
      }
    }
  }

  durations.sort((left, right) => left - right)
  // Every session is kept, so this is a true median — unlike the averages
  // elsewhere in this file, which are reconstructed from a running sum.
  const medianMs = durations.length === 0 ? 0 : (durations[Math.floor(durations.length / 2)] ?? 0)

  return { count, days: dayCount, longestDay, longestMs, medianMs, singlePrompt }
}

/**
 * Upper bounds in minutes. The last bucket is everything above the final bound,
 * so the array the histogram draws is one longer than this one.
 */
const SESSION_BOUNDS = [5, 15, 30, 60, 120] as const

/** One label per bucket, for the bar rows the Projects page draws. */
export const SESSION_BUCKETS = [
  'under 5 min',
  '5 to 15 min',
  '15 to 30 min',
  '30 to 60 min',
  '1 to 2 hours',
  'over 2 hours',
] as const

/**
 * How many sessions fell in each length bucket.
 *
 * A median and a longest say where the middle and the edge are but not the
 * shape, and the shape is the interesting part: a day of one long session and a
 * day of twenty two-minute ones have the same total and nothing else in common.
 */
export function sessionLengths(days: UsageDays): number[] {
  const buckets = Array.from({ length: SESSION_BUCKETS.length }, () => 0)
  for (const day of Object.values(days)) {
    for (const session of Object.values(day.sessions)) {
      const minutes = Math.max(0, session.last - session.first) / 60_000
      const found = SESSION_BOUNDS.findIndex((bound) => minutes < bound)
      const index = found === -1 ? buckets.length - 1 : found
      buckets[index] = (buckets[index] ?? 0) + 1
    }
  }
  return buckets
}

// ─── Means ───────────────────────────────────────────────────────────────────

export function totalMean(days: UsageDays, pick: (day: UsageDay) => UsageMean): UsageMean {
  let count = 0
  let max = 0
  let sum = 0
  for (const day of Object.values(days)) {
    const mean = pick(day)
    count += mean.count
    sum += mean.sum
    if (mean.max > max) max = mean.max
  }
  return { count, max, sum }
}

export function meanOf(mean: UsageMean): number {
  return mean.count === 0 ? 0 : mean.sum / mean.count
}

// ─── Records ─────────────────────────────────────────────────────────────────

export interface DayRecord {
  day: string
  value: number
}

export function peakDay(days: UsageDays, pick: (day: UsageDay) => number): DayRecord {
  let best: DayRecord = { day: '', value: 0 }
  for (const [key, day] of Object.entries(days)) {
    const value = pick(day)
    if (value > best.value) best = { day: key, value }
  }
  return best
}

/** Prompts sent between 02:00 and 04:59 local — the buckets, not a session span. */
export function lateNightPrompts(days: UsageDays): number {
  let total = 0
  for (const day of Object.values(days)) {
    for (let hour = 2; hour <= 4; hour++) total += day.hours[hour] ?? 0
  }
  return total
}

import type { CounterDays, CounterKey, MaxCounterKey } from './store'

/** Pure shaping of the stored counter days into what the aimux and Records pages render. */

export interface CounterPeak {
  day: string
  value: number
}

export interface CounterSummary {
  best: CounterPeak
  today: number
  total: number
  /** Days carrying a non-zero value — the denominator for a daily average. */
  days: number
}

export function summarizeCounter(
  days: CounterDays,
  key: CounterKey,
  today: string
): CounterSummary {
  let best: CounterPeak = { day: '', value: 0 }
  let dayCount = 0
  let total = 0

  for (const [date, day] of Object.entries(days)) {
    const value = day[key] ?? 0
    if (value <= 0) continue
    dayCount += 1
    total += value
    if (value > best.value) best = { day: date, value }
  }

  return { best, days: dayCount, today: days[today]?.[key] ?? 0, total }
}

/**
 * The largest value ever recorded for a max-merged counter.
 *
 * Not a sum: `longestRunMs` is the length of one uninterrupted aimux run, so the
 * answer across days is the biggest of them, never their total.
 */
export function peakOf(days: CounterDays, key: MaxCounterKey): CounterPeak {
  let best: CounterPeak = { day: '', value: 0 }
  for (const [date, day] of Object.entries(days)) {
    const value = day[key] ?? 0
    if (value > best.value) best = { day: date, value }
  }
  return best
}

export function sumOf(days: CounterDays, key: CounterKey): number {
  let total = 0
  for (const day of Object.values(days)) total += day[key] ?? 0
  return total
}

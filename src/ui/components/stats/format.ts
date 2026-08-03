/**
 * Number and time formatting for the stats screen.
 *
 * Separate from `format-number.ts`, which is the shared token formatter: these
 * are durations, clock times and dates that only this screen renders.
 */

const MINUTES_IN_HOUR = 60
const MS_PER_SECOND = 1000
const MS_PER_MINUTE = 60 * MS_PER_SECOND
const MS_PER_HOUR = 60 * MS_PER_MINUTE

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Thin spaces rather than commas, matching the History page's existing totals. */
export function formatCount(value: number): string {
  return Math.round(value).toLocaleString('en-US').replaceAll(',', ' ')
}

/** `9h 04` / `22 min` / `41 s`. Picks the largest unit that is not a rounding lie. */
export function formatDuration(ms: number): string {
  if (ms <= 0) return '—'
  if (ms < MS_PER_MINUTE) return `${Math.round(ms / MS_PER_SECOND)} s`
  if (ms < MS_PER_HOUR) return `${Math.round(ms / MS_PER_MINUTE)} min`
  const hours = Math.floor(ms / MS_PER_HOUR)
  const minutes = Math.round((ms % MS_PER_HOUR) / MS_PER_MINUTE)
  return `${hours}h ${String(minutes).padStart(2, '0')}`
}

/** Minutes past local midnight as `09:12`. */
export function formatClock(minutes: number): string {
  const hours = Math.floor(minutes / MINUTES_IN_HOUR)
  return `${String(hours).padStart(2, '0')}:${String(minutes % MINUTES_IN_HOUR).padStart(2, '0')}`
}

/** `2026-03-14` as `Mar 14`. Empty in, empty out — a record with no day shows none. */
export function formatDayLabel(key: string): string {
  if (key === '') return ''
  const [, month, day] = key.split('-').map(Number)
  const name = MONTHS[(month ?? 1) - 1]
  if (name === undefined) return key
  return `${name} ${day ?? ''}`
}

export function formatPercent(part: number, whole: number): string {
  if (whole <= 0) return '—'
  return `${Math.round((part / whole) * 100)}%`
}

/** Keystrokes as a distance, at roughly the travel of one key press. */
const KEY_TRAVEL_MM = 0.8

export function formatFingerDistance(keys: number): string {
  const metres = (keys * KEY_TRAVEL_MM) / 1000
  if (metres >= 1000) return `${(metres / 1000).toFixed(1)} km`
  if (metres >= 1) return `${metres.toFixed(0)} m`
  return `${(metres * 100).toFixed(0)} cm`
}

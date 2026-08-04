import {
  type CounterDeltas,
  type CounterKey,
  type MaxCounters,
  saveCounters,
  todayKey,
} from './store'

/**
 * The write side of the aimux counters: accumulate in memory, fold into the file
 * on a timer.
 *
 * `bump` is on the keystroke path, so it does nothing but add to a plain object —
 * no date formatting, no I/O, no allocation.
 */

const FLUSH_INTERVAL_MS = 30_000

let pending: CounterDeltas = {}
let flushTimer: ReturnType<typeof setInterval> | null = null
let runStartMs = 0
let lastAccrualMs = 0

export function bump(key: CounterKey, amount = 1): void {
  if (amount === 0) return
  pending[key] = (pending[key] ?? 0) + amount
}

/**
 * Folds everything pending into the file.
 *
 * On failure the pending deltas are kept rather than dropped, so a transient
 * write error costs a flush interval instead of the counts.
 *
 * ponytail: the whole batch is attributed to the day it is flushed on, so up to
 * one interval of activity can land on the wrong side of midnight. Per-bump day
 * resolution would fix it and would put a date format on the keystroke path;
 * tighten it only if a day boundary ever matters more than that.
 */
export function flushCounters(now = Date.now()): void {
  if (runStartMs === 0) return

  const elapsed = Math.max(0, now - lastAccrualMs)
  const deltas: CounterDeltas = { ...pending }
  if (elapsed > 0) deltas.uptimeMs = (deltas.uptimeMs ?? 0) + elapsed
  const maxima: MaxCounters = { longestRunMs: now - runStartMs }

  // `elapsed` is already folded into `deltas` above, so this covers the idle
  // case too: nothing pending and no time accrued means nothing to write.
  if (!Object.values(deltas).some((value) => value !== 0)) return

  if (saveCounters(todayKey(new Date(now)), deltas, maxima)) {
    pending = {}
    lastAccrualMs = now
  }
}

/** Starts the flush loop and arranges a final flush on exit. Safe to call twice. */
export function startCounters(now = Date.now()): void {
  if (flushTimer !== null) return
  runStartMs = now
  lastAccrualMs = now
  bump('runsStarted')

  flushTimer = setInterval(() => {
    flushCounters()
  }, FLUSH_INTERVAL_MS)
  // Never hold the process open for a counter.
  flushTimer.unref?.()

  // Synchronous write, which is the only kind `exit` can run. A SIGKILL still
  // costs at most one interval.
  process.on('exit', () => {
    flushCounters()
  })
}

/**
 * Records one increment and writes it straight away.
 *
 * For the short-lived CLI subcommands (`aimux restart-daemon`), which have no
 * flush loop and exit before any timer would fire. The write is additive like
 * every other, so it composes with a TUI running at the same time.
 */
export function recordOnce(key: CounterKey, amount = 1, now = Date.now()): void {
  saveCounters(todayKey(new Date(now)), { [key]: amount }, {})
}

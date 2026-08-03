import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { logDebug } from '../../debug/input-log'
import { localDay } from '../usage-history/store'

/**
 * What aimux knows about its own use, per local calendar day.
 *
 * Deliberately counts and nothing else. `keys` is a number of key presses with
 * no key identity and no content attached — which is also why there is no
 * per-keybind breakdown: that would mean recording *which* key, a different
 * privacy posture for a stat nobody asked for.
 *
 * Nothing here leaves the machine.
 */

export const COUNTERS_VERSION = 1
const UNREADABLE_VERSION = -1

export type CounterKey =
  | 'daemonRestarts'
  | 'keys'
  /** aimux launches. Distinct from `tabsOpened`: a tab is a session inside one run. */
  | 'runsStarted'
  | 'scrollLines'
  | 'snippetsFired'
  | 'splitsHorizontal'
  | 'splitsVertical'
  | 'tabsOpened'
  | 'uptimeMs'
  | 'workspacesCreated'

/**
 * Counters that take the larger of the two values instead of the sum.
 *
 * `longestRunMs` is the length of a single uninterrupted aimux run, so adding
 * two instances' values would invent a run neither of them had.
 */
export type MaxCounterKey = 'longestRunMs'

export type CounterDeltas = Partial<Record<CounterKey, number>>
export type MaxCounters = Partial<Record<MaxCounterKey, number>>

export type CounterDay = Partial<Record<CounterKey | MaxCounterKey, number>>
/** 'YYYY-MM-DD' in the machine's local calendar -> that day's counters. */
export type CounterDays = Record<string, CounterDay>

export interface CountersFile {
  days: CounterDays
  version: number
}

const MAX_KEYS: readonly MaxCounterKey[] = ['longestRunMs']

function isMaxKey(key: string): key is MaxCounterKey {
  return (MAX_KEYS as readonly string[]).includes(key)
}

/** Resolved per call, not at module scope, so a `HOME` override in tests reaches it. */
export function countersPath(): string {
  const home = process.env.HOME ?? homedir()
  return join(home, '.config', 'aimux', 'usage-counters.json')
}

export function readCounters(): CountersFile {
  let raw: string
  try {
    raw = readFileSync(countersPath(), 'utf8')
  } catch {
    return { days: {}, version: COUNTERS_VERSION } // no file yet; safe to create
  }

  try {
    const file = JSON.parse(raw) as Partial<CountersFile>
    if (typeof file.version !== 'number') return { days: {}, version: UNREADABLE_VERSION }
    if (typeof file.days !== 'object' || file.days === null) {
      return { days: {}, version: UNREADABLE_VERSION }
    }
    return { days: file.days, version: file.version }
  } catch {
    return { days: {}, version: UNREADABLE_VERSION }
  }
}

/**
 * Folds one day's pending changes into what is already on disk.
 *
 * Additive for every ordinary counter, which is what makes two aimux instances
 * safe to run at once: each flush contributes its own delta rather than
 * overwriting a total it computed from a stale read.
 */
export function mergeCounterDay(
  stored: CounterDay | undefined,
  deltas: CounterDeltas,
  maxima: MaxCounters
): CounterDay {
  const merged: CounterDay = { ...stored }
  for (const [key, value] of Object.entries(deltas)) {
    if (value === 0) continue
    merged[key as CounterKey] = (merged[key as CounterKey] ?? 0) + value
  }
  for (const [key, value] of Object.entries(maxima)) {
    if (!isMaxKey(key)) continue
    merged[key] = Math.max(merged[key] ?? 0, value)
  }
  return merged
}

/**
 * False when nothing was written. The caller keeps its pending deltas in that
 * case, so a transient failure costs a flush interval rather than the counts.
 */
export function saveCounters(day: string, deltas: CounterDeltas, maxima: MaxCounters): boolean {
  const stored = readCounters()

  // Same posture as the usage history: a newer aimux owns a shape this build
  // cannot round-trip, and an unreadable file may hold counts nothing can
  // regenerate. Neither gets written over.
  if (stored.version > COUNTERS_VERSION || stored.version < 1) {
    logDebug('counters.refusedWrite', { version: stored.version })
    return false
  }

  const path = countersPath()
  const file: CountersFile = {
    days: { ...stored.days, [day]: mergeCounterDay(stored.days[day], deltas, maxima) },
    version: COUNTERS_VERSION,
  }

  try {
    mkdirSync(dirname(path), { recursive: true })
    // pid-suffixed: two instances can flush at once, and a shared tmp name would
    // let one truncate the other's half-written file.
    const tmpPath = `${path}.${process.pid}.tmp`
    writeFileSync(tmpPath, `${JSON.stringify(file, null, 2)}\n`)
    renameSync(tmpPath, path)
    return true
  } catch (error) {
    logDebug('counters.writeError', {
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

export function todayKey(now: Date = new Date()): string {
  return localDay(now)
}

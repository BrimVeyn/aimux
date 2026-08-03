import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  COUNTERS_VERSION,
  countersPath,
  mergeCounterDay,
  readCounters,
  saveCounters,
} from '../../src/services/aimux-counters/store'

const originalHome = process.env.HOME
const dirs: string[] = []

/** Points HOME at a scratch dir and returns the path the production resolver picks. */
function withHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'aimux-counters-'))
  dirs.push(home)
  process.env.HOME = home
  return countersPath()
}

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

describe('mergeCounterDay', () => {
  test('ordinary counters add rather than overwrite', () => {
    const merged = mergeCounterDay({ keys: 100 }, { keys: 5, tabsOpened: 1 }, {})

    // This is the whole reason a flush contributes a delta instead of a total:
    // two aimux instances flushing in any order must sum to the same number.
    expect(merged.keys).toBe(105)
    expect(merged.tabsOpened).toBe(1)
  })

  test('interleaved flushes from two instances sum', () => {
    const first = mergeCounterDay(undefined, { keys: 10 }, {})
    const second = mergeCounterDay(first, { keys: 7 }, {})
    const third = mergeCounterDay(second, { keys: 3 }, {})

    expect(third.keys).toBe(20)
  })

  test('longestRunMs takes the larger value, never the sum', () => {
    const merged = mergeCounterDay({ longestRunMs: 9000 }, {}, { longestRunMs: 4000 })

    // Adding two instances' run lengths would invent a run neither of them had.
    expect(merged.longestRunMs).toBe(9000)
    expect(mergeCounterDay({ longestRunMs: 9000 }, {}, { longestRunMs: 12_000 }).longestRunMs).toBe(
      12_000
    )
  })

  test('a zero delta leaves the stored value untouched', () => {
    expect(mergeCounterDay({ keys: 42 }, { keys: 0 }, {})).toEqual({ keys: 42 })
  })
})

describe('counters file', () => {
  test('round-trips through disk', () => {
    withHome()

    expect(saveCounters('2026-08-03', { keys: 12, uptimeMs: 5000 }, { longestRunMs: 5000 })).toBe(
      true
    )

    const read = readCounters()
    expect(read.version).toBe(COUNTERS_VERSION)
    expect(read.days['2026-08-03']).toEqual({ keys: 12, longestRunMs: 5000, uptimeMs: 5000 })
  })

  test('a second save on the same day accumulates', () => {
    withHome()

    saveCounters('2026-08-03', { keys: 12 }, {})
    saveCounters('2026-08-03', { keys: 8 }, {})

    expect(readCounters().days['2026-08-03']?.keys).toBe(20)
  })

  test('saving a new day leaves earlier days alone', () => {
    withHome()

    saveCounters('2026-08-02', { keys: 100 }, {})
    saveCounters('2026-08-03', { keys: 1 }, {})

    const { days } = readCounters()
    expect(days['2026-08-02']?.keys).toBe(100)
    expect(days['2026-08-03']?.keys).toBe(1)
  })

  test('refuses to overwrite a file written by a newer version', () => {
    const path = withHome()
    const foreign = `${JSON.stringify({ days: {}, version: 99 }, null, 2)}\n`
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, foreign)

    expect(saveCounters('2026-08-03', { keys: 1 }, {})).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe(foreign)
  })

  test('refuses to overwrite a file it cannot parse', () => {
    const path = withHome()
    const corrupt = '{"days":{"2026-01-13":'
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, corrupt)

    // A truncated file may still hold counts nothing can regenerate — there is
    // no second source for "how many keys did you press in March".
    expect(saveCounters('2026-08-03', { keys: 1 }, {})).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe(corrupt)
  })

  test('a missing file reads as empty and is writable', () => {
    withHome()
    expect(readCounters().days).toEqual({})
    expect(saveCounters('2026-08-03', { keys: 1 }, {})).toBe(true)
  })
})

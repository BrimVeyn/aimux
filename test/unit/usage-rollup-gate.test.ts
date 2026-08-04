import { describe, expect, test } from 'bun:test'

import { HISTORY_VERSION, storedVersionIsStale } from '../../src/services/usage-history/store'

/**
 * The rollup's second gate.
 *
 * The mtime alone makes an upgrade wait out the whole interval before the new
 * fields exist, and until then the pages report them as "recorded from the next
 * rollup onward" — which reads as a bug rather than as a pending job.
 */
describe('storedVersionIsStale', () => {
  test('an older schema forces a rollup however fresh the file is', () => {
    expect(storedVersionIsStale('{"tools":{},"version":1}')).toBe(HISTORY_VERSION > 1)
    expect(storedVersionIsStale(`{"tools":{},"version":${HISTORY_VERSION}}`)).toBe(false)
  })

  test('a newer schema is left alone — that build owns a shape this one cannot write', () => {
    expect(storedVersionIsStale(`{"tools":{},"version":${HISTORY_VERSION + 1}}`)).toBe(false)
  })

  test('a file with no readable version does not force anything', () => {
    // Unparseable or truncated: the write guard refuses it anyway, and spawning
    // a rollup every launch over a file nothing can fix is a busy loop.
    expect(storedVersionIsStale('')).toBe(false)
    expect(storedVersionIsStale('{"tools":{}}')).toBe(false)
    expect(storedVersionIsStale('not json at all')).toBe(false)
  })

  test('it reads the file version, not a day that happens to sit before it', () => {
    // The real file serializes `tools` first and `version` last, and no day
    // carries a version of its own — this is the assumption the regex rests on.
    const raw = JSON.stringify({ tools: { claude: { '2026-08-03': { prompts: 3 } } }, version: 1 })
    expect(storedVersionIsStale(raw)).toBe(HISTORY_VERSION > 1)
  })
})

import { describe, expect, test } from 'bun:test'

import { nextDelay, sameEntry } from '../../src/git/workspace-divergence-poller'

/**
 * Measuring one workspace costs three `git` spawns and re-stats its worktree, so
 * a workspace that keeps reading back the same numbers earns a longer wait. The
 * two halves that decide it: what counts as "the same", and how fast the wait
 * grows back down to base once it isn't.
 */
describe('workspace divergence backoff', () => {
  test('an unchanged workspace doubles its wait up to the ceiling', () => {
    let delay = 4000
    const waits: number[] = []
    for (let i = 0; i < 5; i++) {
      delay = nextDelay(delay, false)
      waits.push(delay)
    }
    expect(waits).toEqual([8000, 16000, 30000, 30000, 30000])
  })

  test('a change drops the wait straight back to base', () => {
    expect(nextDelay(30000, true)).toBe(4000)
  })

  test('line counts count as a change, not just commits', () => {
    const base = { added: 10, ahead: 1, behind: 0, removed: 2 }
    expect(sameEntry(base, { ...base })).toBe(true)
    // The common case: an agent editing a workspace without committing moves
    // only `added`/`removed`. Treating that as unchanged would back the poller
    // off exactly while the numbers are moving.
    expect(sameEntry(base, { ...base, added: 11 })).toBe(false)
    expect(sameEntry(base, { ...base, removed: 3 })).toBe(false)
    expect(sameEntry(base, { ...base, ahead: 2 })).toBe(false)
  })

  test('a never-measured workspace is due immediately', () => {
    expect(sameEntry(undefined, { ahead: 0, behind: 0 })).toBe(false)
  })
})

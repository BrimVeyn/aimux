import { describe, expect, test } from 'bun:test'

import { pickMergeFlag } from '../../src/git/pr-merge'

const NONE = { mergeCommitAllowed: false, rebaseMergeAllowed: false, squashMergeAllowed: false }

describe('pickMergeFlag', () => {
  test('prefers a merge commit, like the GitHub button', () => {
    expect(
      pickMergeFlag({
        mergeCommitAllowed: true,
        rebaseMergeAllowed: true,
        squashMergeAllowed: true,
      })
    ).toBe('--merge')
  })

  test('falls back through squash then rebase', () => {
    expect(pickMergeFlag({ ...NONE, rebaseMergeAllowed: true, squashMergeAllowed: true })).toBe(
      '--squash'
    )
    expect(pickMergeFlag({ ...NONE, rebaseMergeAllowed: true })).toBe('--rebase')
  })

  test('returns null when the repo allows nothing', () => {
    expect(pickMergeFlag(NONE)).toBeNull()
  })
})

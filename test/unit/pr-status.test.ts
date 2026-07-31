import { describe, expect, test } from 'bun:test'

import { parsePrView } from '../../src/git/pr-status'

// Verbatim `gh pr view --json …` output for BrimVeyn/aimux#98.
const REAL_PR_98 = {
  additions: 1214,
  baseRefName: 'main',
  changedFiles: 41,
  deletions: 1017,
  headRefName: 'feat/widget-bars',
  isDraft: false,
  number: 98,
  reviewDecision: '',
  state: 'MERGED',
  statusCheckRollup: [
    {
      __typename: 'CheckRun',
      completedAt: '2026-07-31T10:39:45Z',
      conclusion: 'SUCCESS',
      detailsUrl: 'https://github.com/BrimVeyn/aimux/actions/runs/1/job/2',
      name: 'check',
      startedAt: '2026-07-31T10:39:26Z',
      status: 'COMPLETED',
      workflowName: 'CI',
    },
  ],
  title: 'feat(layout): configurable left/right widget bars',
  url: 'https://github.com/BrimVeyn/aimux/pull/98',
}

describe('parsePrView', () => {
  test('maps a real gh payload', () => {
    const result = parsePrView(REAL_PR_98)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.pr).toEqual({
      additions: 1214,
      base: 'main',
      changedFiles: 41,
      deletions: 1017,
      head: 'feat/widget-bars',
      isDraft: false,
      number: 98,
      reviewDecision: '',
      state: 'MERGED',
      title: 'feat(layout): configurable left/right widget bars',
      url: 'https://github.com/BrimVeyn/aimux/pull/98',
    })
    expect(result.checks).toEqual([
      {
        durationMs: 19_000,
        name: 'check',
        state: 'pass',
        url: 'https://github.com/BrimVeyn/aimux/actions/runs/1/job/2',
        workflow: 'CI',
      },
    ])
  })

  test('classifies every CheckRun bucket', () => {
    const rollup = [
      { __typename: 'CheckRun', conclusion: 'SUCCESS', name: 'a', status: 'COMPLETED' },
      { __typename: 'CheckRun', conclusion: 'NEUTRAL', name: 'b', status: 'COMPLETED' },
      { __typename: 'CheckRun', conclusion: 'FAILURE', name: 'c', status: 'COMPLETED' },
      { __typename: 'CheckRun', conclusion: 'TIMED_OUT', name: 'd', status: 'COMPLETED' },
      { __typename: 'CheckRun', conclusion: 'SKIPPED', name: 'e', status: 'COMPLETED' },
      { __typename: 'CheckRun', conclusion: 'CANCELLED', name: 'f', status: 'COMPLETED' },
      { __typename: 'CheckRun', conclusion: '', name: 'g', status: 'IN_PROGRESS' },
      { __typename: 'CheckRun', conclusion: '', name: 'h', status: 'QUEUED' },
      // A completed run whose conclusion GitHub has not filled in yet must not
      // read as a pass.
      { __typename: 'CheckRun', conclusion: '', name: 'i', status: 'COMPLETED' },
    ]
    const result = parsePrView({ number: 1, statusCheckRollup: rollup })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.checks.map((c) => c.state)).toEqual([
      'pass',
      'pass',
      'fail',
      'fail',
      'skipping',
      'cancel',
      'pending',
      'pending',
      'fail',
    ])
  })

  test('classifies StatusContext entries and reads their own fields', () => {
    const rollup = [
      {
        __typename: 'StatusContext',
        context: 'ci/legacy',
        state: 'SUCCESS',
        targetUrl: 'https://ci.example/1',
      },
      { __typename: 'StatusContext', context: 'ci/pending', state: 'PENDING', targetUrl: '' },
      { __typename: 'StatusContext', context: 'ci/expected', state: 'EXPECTED', targetUrl: '' },
      { __typename: 'StatusContext', context: 'ci/broken', state: 'ERROR', targetUrl: '' },
    ]
    const result = parsePrView({ number: 1, statusCheckRollup: rollup })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.checks.map((c) => [c.name, c.state])).toEqual([
      ['ci/legacy', 'pass'],
      ['ci/pending', 'pending'],
      ['ci/expected', 'pending'],
      ['ci/broken', 'fail'],
    ])
    expect(result.checks[0]?.url).toBe('https://ci.example/1')
    expect(result.checks[0]?.durationMs).toBeNull()
  })

  test('leaves durationMs null when timestamps are missing or reversed', () => {
    const result = parsePrView({
      number: 1,
      statusCheckRollup: [
        { __typename: 'CheckRun', name: 'a', startedAt: '2026-01-01T00:00:00Z', status: 'QUEUED' },
        {
          __typename: 'CheckRun',
          completedAt: '2026-01-01T00:00:00Z',
          name: 'b',
          startedAt: '2026-01-01T00:01:00Z',
          status: 'COMPLETED',
        },
      ],
    })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.checks.map((c) => c.durationMs)).toEqual([null, null])
  })

  test('treats a missing PR as no-pr rather than an error', () => {
    expect(parsePrView(null).kind).toBe('no-pr')
    expect(parsePrView({}).kind).toBe('no-pr')
    expect(parsePrView('no pull requests found for branch "main"').kind).toBe('no-pr')
  })

  test('tolerates a PR with no rollup at all', () => {
    const result = parsePrView({ number: 7, title: 'wip' })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.checks).toEqual([])
    expect(result.pr.additions).toBe(0)
    expect(result.pr.base).toBe('')
  })
})

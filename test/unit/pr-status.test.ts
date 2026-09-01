import { describe, expect, test } from 'bun:test'

import {
  clampPrBody,
  parsePrView,
  prActionState,
  type PrCheck,
  prCleanupKind,
  type PrSummary,
} from '../../src/git/pr-status'

// Verbatim `gh pr view --json …` output for BrimVeyn/aimux#98.
const REAL_PR_98 = {
  additions: 1214,
  baseRefName: 'main',
  body: 'Adds configurable bars.\n',
  changedFiles: 41,
  deletions: 1017,
  headRefName: 'feat/widget-bars',
  isDraft: false,
  mergeable: 'UNKNOWN',
  mergeStateStatus: 'UNKNOWN',
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
      body: 'Adds configurable bars.',
      changedFiles: 41,
      deletions: 1017,
      head: 'feat/widget-bars',
      isDraft: false,
      mergeable: 'UNKNOWN',
      mergeStateStatus: 'UNKNOWN',
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
    expect(result.pr.body).toBe('')
  })
})

function pr(overrides: Partial<PrSummary> = {}): PrSummary {
  return {
    additions: 0,
    base: 'main',
    body: '',
    changedFiles: 0,
    deletions: 0,
    head: 'feature',
    isDraft: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    number: 1,
    reviewDecision: '',
    state: 'OPEN',
    title: 'wip',
    url: 'https://github.com/o/r/pull/1',
    ...overrides,
  }
}

const PENDING: PrCheck[] = [
  { durationMs: null, name: 'build', state: 'pending', url: '', workflow: 'CI' },
]

describe('prActionState', () => {
  test('offers merge on a clean PR', () => {
    expect(prActionState(pr(), [])).toEqual({
      action: 'merge',
      label: 'Ready to merge',
      tone: 'ok',
    })
  })

  test('still offers merge when only non-required checks failed', () => {
    const state = prActionState(pr({ mergeStateStatus: 'UNSTABLE' }), [])
    expect(state.action).toBe('merge')
    expect(state.label).toBe('Checks failing')
  })

  test('offers nothing while a check is still running', () => {
    expect(prActionState(pr(), PENDING)).toEqual({
      action: null,
      label: 'Checks running',
      tone: 'neutral',
    })
  })

  test('conflicts outrank a still-running check', () => {
    const state = prActionState(
      pr({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }),
      PENDING
    )
    expect(state).toEqual({ action: null, label: 'Merge conflicts', tone: 'blocked' })
  })

  test('terminal states outrank everything, including conflicts', () => {
    expect(prActionState(pr({ mergeable: 'CONFLICTING', state: 'MERGED' }), PENDING).label).toBe(
      'Merged'
    )
    expect(prActionState(pr({ state: 'CLOSED' }), []).label).toBe('Closed')
  })

  test('offers cleanup once merged, and only then', () => {
    expect(prActionState(pr({ state: 'MERGED' }), PENDING)).toEqual({
      action: 'cleanup',
      label: 'Merged',
      tone: 'ok',
    })
    expect(prActionState(pr({ state: 'CLOSED' }), []).action).toBeNull()
    expect(prActionState(pr(), []).action).toBe('merge')
  })

  test('cleanup drops a linked workspace but only switches branch on the checkout', () => {
    const merged = { base: 'main', head: 'feat/x' }
    expect(prCleanupKind('cleanup', merged, true)).toBe('worktree')
    expect(prCleanupKind('cleanup', merged, false)).toBe('branch')
    // Whatever the PR targeted is where we land — never a hardcoded `main`.
    expect(prCleanupKind('cleanup', { base: 'develop', head: 'feat/x' }, false)).toBe('branch')
  })

  test('never offers cleanup without a merge, or with nowhere to go', () => {
    expect(prCleanupKind('merge', { base: 'main', head: 'feat/x' }, true)).toBeNull()
    expect(prCleanupKind(null, { base: 'main', head: 'feat/x' }, true)).toBeNull()
    // Already on the base, or the base is unknown: no branch to switch to.
    expect(prCleanupKind('cleanup', { base: 'main', head: 'main' }, false)).toBeNull()
    expect(prCleanupKind('cleanup', { base: '', head: 'feat/x' }, false)).toBeNull()
  })

  test('never offers merge on a draft', () => {
    expect(prActionState(pr({ isDraft: true }), [])).toEqual({
      action: null,
      label: 'Draft',
      tone: 'neutral',
    })
  })

  test('labels the blocking merge states without an action', () => {
    expect(prActionState(pr({ mergeStateStatus: 'BLOCKED' }), []).label).toBe('Blocked')
    expect(prActionState(pr({ mergeStateStatus: 'BEHIND' }), []).label).toBe('Out of date')
    expect(prActionState(pr({ mergeStateStatus: 'BLOCKED' }), []).action).toBeNull()
    expect(prActionState(pr({ mergeStateStatus: 'BEHIND' }), []).action).toBeNull()
  })

  test('falls back to a neutral label on an unknown merge state', () => {
    expect(prActionState(pr({ mergeStateStatus: 'UNKNOWN' }), [])).toEqual({
      action: null,
      label: 'Checking…',
      tone: 'neutral',
    })
  })
})

describe('clampPrBody', () => {
  test('leaves a short body alone', () => {
    expect(clampPrBody('one\ntwo')).toEqual({ text: 'one\ntwo', truncated: false })
  })

  test('cuts a bullet list on the line limit', () => {
    const body = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].join('\n')
    expect(clampPrBody(body)).toEqual({ text: 'a\nb\nc\nd\ne', truncated: true })
  })

  test('cuts a wall of text on the char limit, at a word boundary', () => {
    const { text, truncated } = clampPrBody('lorem ipsum '.repeat(60), 5, 40)
    expect(truncated).toBe(true)
    expect(text.length).toBeLessThanOrEqual(40)
    expect(text.endsWith('ipsum') || text.endsWith('lorem')).toBe(true)
  })

  test('hard-cuts when no word boundary is reachable', () => {
    const { text, truncated } = clampPrBody('x'.repeat(200), 5, 40)
    expect(truncated).toBe(true)
    expect(text).toHaveLength(40)
  })

  test('trailing whitespace alone is not a truncation', () => {
    expect(clampPrBody('one\ntwo\n\n\n')).toEqual({ text: 'one\ntwo', truncated: false })
  })
})

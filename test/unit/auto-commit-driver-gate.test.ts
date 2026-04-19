import { expect, test } from 'bun:test'

import type { AutoCommitState, GitRefreshPayload } from '../../src/state/types'

import { shouldTriggerAutoCommit } from '../../src/app-runtime/auto-commit-driver'

const EMPTY_GIT: GitRefreshPayload = { ahead: 0, behind: 0, branch: 'main', files: [] }
const DIRTY_GIT: GitRefreshPayload = {
  ahead: 0,
  behind: 0,
  branch: 'main',
  files: [{ added: 1, path: 'a.ts', removed: 0, section: 'unstaged', status: 'M' }],
}

const EMPTY_STATE: AutoCommitState = { bySession: {} }

test('triggers when enabled + supported + diff + prev state idle', () => {
  expect(
    shouldTriggerAutoCommit({
      assistant: 'claude',
      currentHash: 'h1',
      enabled: true,
      git: DIRTY_GIT,
      hasProjectPath: true,
      sessionId: 's1',
      state: EMPTY_STATE,
    })
  ).toBe(true)
})

test('does not trigger when disabled', () => {
  expect(
    shouldTriggerAutoCommit({
      assistant: 'claude',
      currentHash: 'h1',
      enabled: false,
      git: DIRTY_GIT,
      hasProjectPath: true,
      sessionId: 's1',
      state: EMPTY_STATE,
    })
  ).toBe(false)
})

test('does not trigger for unsupported provider', () => {
  expect(
    shouldTriggerAutoCommit({
      assistant: 'terminal',
      currentHash: 'h1',
      enabled: true,
      git: DIRTY_GIT,
      hasProjectPath: true,
      sessionId: 's1',
      state: EMPTY_STATE,
    })
  ).toBe(false)
})

test('does not trigger without project path', () => {
  expect(
    shouldTriggerAutoCommit({
      assistant: 'claude',
      currentHash: 'h1',
      enabled: true,
      git: DIRTY_GIT,
      hasProjectPath: false,
      sessionId: 's1',
      state: EMPTY_STATE,
    })
  ).toBe(false)
})

test('does not trigger with empty git', () => {
  expect(
    shouldTriggerAutoCommit({
      assistant: 'claude',
      currentHash: 'h1',
      enabled: true,
      git: EMPTY_GIT,
      hasProjectPath: true,
      sessionId: 's1',
      state: EMPTY_STATE,
    })
  ).toBe(false)
})

test('does not re-trigger when ready with the same hash', () => {
  const state: AutoCommitState = {
    bySession: {
      s1: {
        body: '',
        generatedAt: 1,
        kind: 'ready',
        tabId: 't1',
        title: 't',
        workingTreeHash: 'h1',
      },
    },
  }
  expect(
    shouldTriggerAutoCommit({
      assistant: 'claude',
      currentHash: 'h1',
      enabled: true,
      git: DIRTY_GIT,
      hasProjectPath: true,
      sessionId: 's1',
      state,
    })
  ).toBe(false)
})

test('does re-trigger when ready with a different hash', () => {
  const state: AutoCommitState = {
    bySession: {
      s1: {
        body: '',
        generatedAt: 1,
        kind: 'ready',
        tabId: 't1',
        title: 't',
        workingTreeHash: 'h-old',
      },
    },
  }
  expect(
    shouldTriggerAutoCommit({
      assistant: 'claude',
      currentHash: 'h-new',
      enabled: true,
      git: DIRTY_GIT,
      hasProjectPath: true,
      sessionId: 's1',
      state,
    })
  ).toBe(true)
})

test('does not re-trigger a dismissed ready with the same hash', () => {
  const state: AutoCommitState = {
    bySession: {
      s1: {
        body: '',
        dismissed: true,
        generatedAt: 1,
        kind: 'ready',
        tabId: 't1',
        title: 't',
        workingTreeHash: 'h1',
      },
    },
  }
  expect(
    shouldTriggerAutoCommit({
      assistant: 'claude',
      currentHash: 'h1',
      enabled: true,
      git: DIRTY_GIT,
      hasProjectPath: true,
      sessionId: 's1',
      state,
    })
  ).toBe(false)
})

test('does re-trigger when dismissed ready sees a new hash', () => {
  const state: AutoCommitState = {
    bySession: {
      s1: {
        body: '',
        dismissed: true,
        generatedAt: 1,
        kind: 'ready',
        tabId: 't1',
        title: 't',
        workingTreeHash: 'h-old',
      },
    },
  }
  expect(
    shouldTriggerAutoCommit({
      assistant: 'claude',
      currentHash: 'h-new',
      enabled: true,
      git: DIRTY_GIT,
      hasProjectPath: true,
      sessionId: 's1',
      state,
    })
  ).toBe(true)
})

test('does not trigger while already generating the same hash', () => {
  const ctrl = new AbortController()
  const state: AutoCommitState = {
    bySession: {
      s1: {
        abortController: ctrl,
        kind: 'generating',
        startedAt: 1,
        tabId: 't1',
        workingTreeHash: 'h1',
      },
    },
  }
  expect(
    shouldTriggerAutoCommit({
      assistant: 'claude',
      currentHash: 'h1',
      enabled: true,
      git: DIRTY_GIT,
      hasProjectPath: true,
      sessionId: 's1',
      state,
    })
  ).toBe(false)
})

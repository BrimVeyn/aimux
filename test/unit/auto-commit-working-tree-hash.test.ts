import { expect, test } from 'bun:test'

import type { GitRefreshPayload } from '../../src/state/types'

import { workingTreeHash } from '../../src/auto-commit/working-tree-hash'

function payload(overrides: Partial<GitRefreshPayload> = {}): GitRefreshPayload {
  return {
    ahead: 0,
    behind: 0,
    branch: 'main',
    files: [],
    ...overrides,
  }
}

test('identical payloads hash to the same value', () => {
  const a = payload({
    files: [{ added: 3, path: 'a.ts', removed: 1, section: 'unstaged', status: 'M' }],
  })
  const b = payload({
    files: [{ added: 3, path: 'a.ts', removed: 1, section: 'unstaged', status: 'M' }],
  })
  expect(workingTreeHash(a)).toBe(workingTreeHash(b))
})

test('changing numstat changes the hash', () => {
  const a = payload({
    files: [{ added: 3, path: 'a.ts', removed: 1, section: 'unstaged', status: 'M' }],
  })
  const b = payload({
    files: [{ added: 4, path: 'a.ts', removed: 1, section: 'unstaged', status: 'M' }],
  })
  expect(workingTreeHash(a)).not.toBe(workingTreeHash(b))
})

test('adding a file changes the hash', () => {
  const a = payload({
    files: [{ added: 0, path: 'a.ts', removed: 0, section: 'unstaged', status: 'M' }],
  })
  const b = payload({
    files: [
      { added: 0, path: 'a.ts', removed: 0, section: 'unstaged', status: 'M' },
      { added: 5, path: 'b.ts', removed: 0, section: 'untracked', status: '?' },
    ],
  })
  expect(workingTreeHash(a)).not.toBe(workingTreeHash(b))
})

test('different branch changes the hash', () => {
  expect(workingTreeHash(payload({ branch: 'main' }))).not.toBe(
    workingTreeHash(payload({ branch: 'feat/x' }))
  )
})

test('file order does not matter', () => {
  const a = payload({
    files: [
      { added: 1, path: 'a.ts', removed: 0, section: 'unstaged', status: 'M' },
      { added: 2, path: 'b.ts', removed: 0, section: 'unstaged', status: 'M' },
    ],
  })
  const b = payload({
    files: [
      { added: 2, path: 'b.ts', removed: 0, section: 'unstaged', status: 'M' },
      { added: 1, path: 'a.ts', removed: 0, section: 'unstaged', status: 'M' },
    ],
  })
  expect(workingTreeHash(a)).toBe(workingTreeHash(b))
})

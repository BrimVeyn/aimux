import { expect, test } from 'bun:test'

import type { GitFileEntry, GitRefreshPayload } from '../../src/state/types'

import { hasStagedFiles } from '../../src/auto-commit/staging-mode'

function mkFile(path: string, section: GitFileEntry['section']): GitFileEntry {
  return { added: 1, path, removed: 0, section, status: 'M' }
}

function payload(files: GitFileEntry[]): GitRefreshPayload {
  return { ahead: 0, behind: 0, branch: 'main', files }
}

test('hasStagedFiles returns true when at least one file is staged', () => {
  expect(hasStagedFiles(payload([mkFile('a.ts', 'unstaged'), mkFile('b.ts', 'staged')]))).toBe(true)
})

test('hasStagedFiles returns false when only unstaged/untracked files exist', () => {
  expect(hasStagedFiles(payload([mkFile('a.ts', 'unstaged'), mkFile('b.ts', 'untracked')]))).toBe(
    false
  )
})

test('hasStagedFiles returns false when the file list is empty', () => {
  expect(hasStagedFiles(payload([]))).toBe(false)
})

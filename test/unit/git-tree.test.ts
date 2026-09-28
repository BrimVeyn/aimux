import { expect, test } from 'bun:test'

import type { GitFileEntry } from '../../src/state/types'

import { buildGitTreeRows, filterGitFiles, gitFolderKey } from '../../src/state/git-tree'

test('buildGitTreeRows keeps section trees isolated for identical paths', () => {
  const files: GitFileEntry[] = [
    { added: 1, path: 'src/app.ts', removed: 0, section: 'staged', status: 'M' },
    { added: 1, path: 'src/app.ts', removed: 0, section: 'unstaged', status: 'M' },
  ]
  const tree = buildGitTreeRows(files, {})
  expect(tree.visibleRows.map((row) => row.key)).toEqual([
    gitFolderKey('staged', 'src'),
    'staged:src/app.ts',
    gitFolderKey('unstaged', 'src'),
    'unstaged:src/app.ts',
  ])
})

test('buildGitTreeRows hides descendants of collapsed folders', () => {
  const files: GitFileEntry[] = [
    { added: 1, path: 'src/ui/a.ts', removed: 0, section: 'unstaged', status: 'M' },
    { added: 1, path: 'src/ui/b.ts', removed: 0, section: 'unstaged', status: 'M' },
    { added: 1, path: 'readme.md', removed: 0, section: 'unstaged', status: 'M' },
  ]
  const tree = buildGitTreeRows(files, { [gitFolderKey('unstaged', 'src')]: true })
  expect(tree.visibleRows.map((row) => row.key)).toEqual([
    gitFolderKey('unstaged', 'src'),
    'unstaged:readme.md',
  ])
})

test('filterGitFiles keeps paths containing the filter, ignoring case', () => {
  const files: GitFileEntry[] = [
    { added: 0, path: 'src/App.ts', removed: 0, section: 'unstaged', status: 'M' },
    { added: 0, path: 'test/app.test.ts', removed: 0, section: 'unstaged', status: 'M' },
    { added: 0, path: 'README.md', removed: 0, section: 'untracked', status: '?' },
  ]
  expect(filterGitFiles(files, 'APP').map((f) => f.path)).toEqual([
    'src/App.ts',
    'test/app.test.ts',
  ])
  expect(filterGitFiles(files, 'src/').map((f) => f.path)).toEqual(['src/App.ts'])
  expect(filterGitFiles(files, 'nope')).toEqual([])
  expect(filterGitFiles(files, '')).toBe(files)
  expect(filterGitFiles(files, null)).toBe(files)
})

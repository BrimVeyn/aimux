import { expect, test } from 'bun:test'

import type { GitFileEntry } from '../../src/state/types'

import { buildGitTreeRows, gitFolderKey } from '../../src/state/git-tree'

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

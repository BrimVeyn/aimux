import { describe, expect, test } from 'bun:test'

import {
  EMPTY,
  reduce,
  rowsOf,
  type Slice,
  totals,
} from '../../examples/plugins/explorer/src/state'
import {
  ancestors,
  DEFAULT_FOLDS,
  fuzzy,
  matchCount,
  nextChanged,
  type RepoFile,
  type Row,
  type TreeView,
  visibleRows,
} from '../../examples/plugins/explorer/src/tree'

const file = (path: string, status: string | null = null, added = 0, removed = 0): RepoFile => ({
  added: status === null ? null : added,
  path,
  removed: status === null ? null : removed,
  status,
})

const FILES: RepoFile[] = [
  file('README.md'),
  file('docs/guide.md', 'M', 3, 1),
  file('docs/other.md'),
  file('src/app.ts'),
  file('src/ui/view.tsx', '?', 10, 0),
  file('src/ui/list.tsx'),
  file('lib/util.ts'),
  file('zeta.ts', 'D', 0, 7),
]

const CHANGES: TreeView = { filter: '', folds: DEFAULT_FOLDS, tab: 'changes' }
const ALL: TreeView = {
  filter: '',
  folds: { ...DEFAULT_FOLDS, files: { open: true, set: {} } },
  tab: 'files',
}

/** Each row as drawn: its guide, then a folder's fold glyph or a file's name. */
const drawn = (rows: readonly Row[]): string[] =>
  rows.map((r) => `${r.guide}${r.kind === 'dir' ? `${r.open ? '▾' : '▸'} ${r.name}/` : r.name}`)

describe('tree', () => {
  test('changes: every changed file, folders open, a folder of one folder as one row', () => {
    expect(drawn(visibleRows(FILES, CHANGES))).toEqual([
      '▾ docs/',
      '└ guide.md',
      '▾ src/ui/',
      '└ view.tsx',
      'zeta.ts',
    ])
  })

  test('files: the whole repository, folders closed', () => {
    expect(drawn(visibleRows(FILES, { ...CHANGES, tab: 'files' }))).toEqual([
      '▸ docs/',
      '▸ lib/',
      '▸ src/',
      'README.md',
      'zeta.ts',
    ])
  })

  test('opened in full: folders first, each by name, tied to their folder by guides', () => {
    expect(drawn(visibleRows(FILES, ALL))).toEqual([
      '▾ docs/',
      '├ guide.md',
      '└ other.md',
      '▾ lib/',
      '└ util.ts',
      '▾ src/',
      '├ ▾ ui/',
      '│ ├ list.tsx',
      '│ └ view.tsx',
      '└ app.ts',
      'README.md',
      'zeta.ts',
    ])
  })

  test('a folder closed by hand stays closed, the others take the default', () => {
    const view = {
      ...CHANGES,
      folds: { ...DEFAULT_FOLDS, changes: { open: true, set: { docs: false } } },
    }
    expect(drawn(visibleRows(FILES, view))).toEqual([
      '▸ docs/',
      '▾ src/ui/',
      '└ view.tsx',
      'zeta.ts',
    ])
  })

  test('a search is fuzzy, opens the way to every match, and marks what matched', () => {
    const rows = visibleRows(FILES, { ...ALL, filter: 'lst' })
    expect(drawn(rows)).toEqual(['▾ src/ui/', '└ list.tsx'])
    const hit = rows[1]
    expect(hit?.kind === 'file' ? hit.match : null).toEqual([0, 2, 5])
    expect(matchCount(FILES, { ...ALL, filter: 'lst' })).toBe(1)
    expect(matchCount(FILES, { ...ALL, filter: 'md' })).toBe(3)
    expect(matchCount(FILES, CHANGES)).toBe(3)
  })

  test('fuzzy: characters in order, from the end, case ignored unless asked for', () => {
    expect(fuzzy('view', 'src/ui/view.tsx')).toEqual([7, 8, 9, 10])
    expect(fuzzy('uv', 'src/ui/view.tsx')).toEqual([4, 7])
    expect(fuzzy('VIEW', 'src/ui/view.tsx')).toBeNull()
    expect(fuzzy('xv', 'src/ui/view.tsx')).toBeNull()
    expect(fuzzy('', 'anything')).toEqual([])
  })

  test('] and [ walk the changed files in tree order, wrapping round', () => {
    expect(ancestors('a/b/c.ts')).toEqual(['a', 'a/b'])
    expect(nextChanged(FILES, null, 1)).toBe('docs/guide.md')
    expect(nextChanged(FILES, 'docs/guide.md', 1)).toBe('src/ui/view.tsx')
    expect(nextChanged(FILES, 'zeta.ts', 1)).toBe('docs/guide.md')
    expect(nextChanged(FILES, 'docs/guide.md', -1)).toBe('zeta.ts')
    // From a file that did not change: placed among the changes by tree order.
    expect(nextChanged(FILES, 'src/app.ts', -1)).toBe('src/ui/view.tsx')
    expect(nextChanged(FILES, 'src/app.ts', 1)).toBe('zeta.ts')
    expect(nextChanged([file('a')], null, 1)).toBeNull()
  })
})

function run(...actions: [string, unknown?][]): Slice {
  let slice = EMPTY
  for (const [actionId, payload] of actions) slice = reduce(slice, { actionId, payload })
  return slice
}

const rowsDrawn = (slice: Slice): string[] => drawn(rowsOf(slice).rows)

describe('reducer', () => {
  test('arriving with work to see: the Changes tab, on the first change', () => {
    const slice = run(['loaded', FILES])
    expect(slice.tab).toBe('changes')
    expect(slice.opened).toBe('docs/guide.md')
    expect(slice.cursor).toBe('f:docs/guide.md')
    expect(slice.revision).toBe(1)
  })

  test('arriving with nothing changed: every file, on the first row', () => {
    const clean = FILES.map((f) => ({ ...f, status: null }))
    const slice = run(['loaded', clean])
    expect(slice.tab).toBe('files')
    expect(slice.cursor).toBe('d:docs')
  })

  test('the file follows the cursor; a folder leaves the last file on screen', () => {
    expect(run(['loaded', FILES], ['move', 1]).cursor).toBe('d:src/ui')
    expect(run(['loaded', FILES], ['move', 1]).opened).toBe('docs/guide.md')
    expect(run(['loaded', FILES], ['move', 2]).opened).toBe('src/ui/view.tsx')
  })

  test('l on a folder opens or closes it; on a file, hands it the keys', () => {
    const closed = run(['loaded', FILES], ['move', 1], ['open'])
    expect(rowsDrawn(closed)).toEqual(['▾ docs/', '└ guide.md', '▸ src/ui/', 'zeta.ts'])
    expect(rowsDrawn(reduce(closed, { actionId: 'open' }))).toHaveLength(5)
    const reading = run(['loaded', FILES], ['open'])
    expect(reading.focus).toBe('file')
    expect(reduce(reading, { actionId: 'focus', payload: 'tree' }).focus).toBe('tree')
  })

  test('h goes up to the folder, then closes it', () => {
    const up = run(['loaded', FILES], ['move', 2], ['close'])
    expect(up.cursor).toBe('d:src/ui')
    const shut = reduce(up, { actionId: 'close' })
    expect(shut.folds.changes.set['src/ui']).toBe(false)
    // Nothing above a top-level row.
    expect(reduce(shut, { actionId: 'close' })).toBe(shut)
  })

  test('⌫ closes the folder the cursor is in, P only goes up to it', () => {
    const view = run(['loaded', FILES], ['move', 2])
    const shut = reduce(view, { actionId: 'parent', payload: 'close' })
    expect(shut.cursor).toBe('d:src/ui')
    expect(shut.folds.changes.set['src/ui']).toBe(false)
    const up = reduce(view, { actionId: 'parent' })
    expect(up.cursor).toBe('d:src/ui')
    expect(up.folds.changes.set['src/ui']).toBeUndefined()
  })

  test('J and K: last and first row of the folder; G and gg, of the tree', () => {
    const top = run(['loaded', FILES], ['move', -1])
    expect(top.cursor).toBe('d:docs')
    expect(reduce(top, { actionId: 'sibling', payload: 1 }).cursor).toBe('f:zeta.ts')
    expect(run(['loaded', FILES], ['edge', 1]).cursor).toBe('f:zeta.ts')
    expect(run(['loaded', FILES], ['edge', -1]).cursor).toBe('d:docs')
  })

  test('tab: the other view of the same repository, the file on screen brought into it', () => {
    const files = run(['loaded', FILES], ['tab'])
    expect(files.tab).toBe('files')
    expect(files.cursor).toBe('f:docs/guide.md')
    expect(rowsDrawn(files)).toEqual([
      '▾ docs/',
      '├ guide.md',
      '└ other.md',
      '▸ lib/',
      '▸ src/',
      'README.md',
      'zeta.ts',
    ])
    // Each tab keeps its own folders.
    expect(files.folds.changes).toEqual(run(['loaded', FILES]).folds.changes)
  })

  test('a click selects; on a folder it opens or closes it, and takes the keys back', () => {
    const reading = run(['loaded', FILES], ['open'])
    const clicked = reduce(reading, { actionId: 'click', payload: 0 })
    expect(clicked.cursor).toBe('d:docs')
    expect(clicked.focus).toBe('tree')
    expect(clicked.folds.changes.set.docs).toBe(false)
  })

  test('E opens every folder; W closes them all, the cursor on the top folder it was in', () => {
    const all = run(['loaded', FILES], ['tab'], ['expandAll'])
    expect(rowsOf(all).rows).toHaveLength(12)
    const onList = run(['loaded', FILES], ['tab'], ['expandAll'], ['filter', 'lst'], ['filter', ''])
    expect(onList.cursor).toBe('f:src/ui/list.tsx')
    const shut = reduce(onList, { actionId: 'collapseAll' })
    expect(shut.cursor).toBe('d:src')
    expect(rowsDrawn(shut)).toEqual(['▸ docs/', '▸ lib/', '▸ src/', 'README.md', 'zeta.ts'])
  })

  test('a search narrows as it is typed; cleared, the file found stays on screen', () => {
    const slice = run(['loaded', FILES], ['tab'], ['filter', 'lst'])
    expect(slice.cursor).toBe('f:src/ui/list.tsx')
    expect(slice.opened).toBe('src/ui/list.tsx')
    const cleared = reduce(slice, { actionId: 'filter', payload: '' })
    expect(cleared.cursor).toBe('f:src/ui/list.tsx')
    expect(cleared.folds.files.set['src/ui']).toBe(true)
  })

  test('] lands on a change a search hides by letting go of the search', () => {
    const slice = run(['loaded', FILES], ['filter', 'guide'], ['jump', 1])
    expect(slice.filter).toBe('')
    expect(slice.opened).toBe('src/ui/view.tsx')
  })

  test('a reload keeps the cursor; a vanished file hands over to the first change', () => {
    const moved = run(['loaded', FILES], ['move', 2])
    const again = reduce(moved, { actionId: 'loaded', payload: FILES })
    expect(again.cursor).toBe(moved.cursor)
    expect(again.revision).toBe(2)
    const without = FILES.filter((f) => f.path !== 'src/ui/view.tsx')
    expect(reduce(moved, { actionId: 'loaded', payload: without }).cursor).toBe('f:docs/guide.md')
  })

  test('once the last change is gone, the whole tree', () => {
    const clean = FILES.map((f) => ({ ...f, status: null }))
    expect(run(['loaded', FILES], ['loaded', clean]).tab).toBe('files')
  })

  test('the header counts every changed line', () => {
    expect(totals(FILES)).toEqual({ added: 13, removed: 8 })
  })

  test('s and m flip how the file is drawn', () => {
    const slice = run(['prefer'], ['markdown'])
    expect(slice.prefer).toBe('file')
    expect(slice.markdown).toBe('source')
  })
})

describe('a large repository', () => {
  const big: RepoFile[] = []
  for (let a = 0; a < 20; a++) {
    for (let b = 0; b < 20; b++) {
      for (let c = 0; c < 50; c++) {
        big.push(file(`pkg${a}/mod${b}/file${c}.ts`, c === 0 && b === 0 ? 'M' : null, 1, 1))
      }
    }
  }

  test('a keypress costs the rows, not the listing: the tree is built once', () => {
    let slice = run(['loaded', big], ['tab'], ['expandAll'])
    expect(rowsOf(slice).rows.length).toBeGreaterThan(20_000)
    const started = performance.now()
    for (let i = 0; i < 100; i++) slice = reduce(slice, { actionId: 'move', payload: 1 })
    // Generous: a rebuild per keypress is ~10 ms here, so a hundred would be a second.
    expect(performance.now() - started).toBeLessThan(300)
  })
})

import {
  ancestors,
  DEFAULT_FOLDS,
  fuzzy,
  nextChanged,
  type RepoFile,
  reveal,
  type Row,
  type Tab,
  type TreeView,
  visibleRows,
} from './tree'

/**
 * What the explorer remembers, and every way a key changes it. Kept apart from
 * the view so the walking rules are tested as plain functions.
 *
 * It outlives the view: closing the explorer and opening it again finds the
 * folders and the cursor where they were.
 */

export interface Slice extends TreeView {
  files: RepoFile[]
  /** The row under the cursor, by key — rows move as folders open and close. */
  cursor: string | null
  /** The file on the right. */
  opened: string | null
  /** Where the keys go: the tree, or the file on the right. */
  focus: 'file' | 'tree'
  prefer: 'diff' | 'file'
  markdown: 'rendered' | 'source'
  /** Bumped by a reload, so the file on screen is read again too. */
  revision: number
  loading: boolean
  error: string | null
}

export const EMPTY: Slice = {
  cursor: null,
  error: null,
  files: [],
  filter: '',
  focus: 'tree',
  folds: DEFAULT_FOLDS,
  loading: false,
  markdown: 'rendered',
  opened: null,
  prefer: 'diff',
  revision: 0,
  tab: 'changes',
}

/**
 * The last rows worked out, for whichever asks next: the reducer and the view
 * both need them for every keypress, and a cursor moving changes none of what
 * they are made from.
 */
let last: {
  files: RepoFile[]
  tab: Tab
  folds: Slice['folds']
  filter: string
  rows: Row[]
} | null = null

/** The cursor's row and the rows around it, as the tree is drawn now. */
export function rowsOf(slice: Slice): { at: number; rows: Row[] } {
  if (
    last?.files !== slice.files ||
    last.tab !== slice.tab ||
    last.folds !== slice.folds ||
    last.filter !== slice.filter
  ) {
    last = { ...slice, rows: visibleRows(slice.files, slice) }
  }
  const { rows } = last
  return { at: rows.findIndex((row) => row.key === slice.cursor), rows }
}

/** Puts the cursor on a row; a file under it is opened. */
function land(slice: Slice, row: Row | undefined): Slice {
  if (row === undefined) return { ...slice, cursor: null }
  return {
    ...slice,
    cursor: row.key,
    opened: row.kind === 'file' ? row.path : slice.opened,
  }
}

/** Opens what leads to `path`, and puts the cursor on it. */
function show(slice: Slice, path: string): Slice {
  return { ...slice, cursor: `f:${path}`, folds: reveal(slice, path), opened: path }
}

/** Whether the tab lists `file` at all, search aside. */
function listed(slice: Slice, file: RepoFile): boolean {
  return (slice.tab === 'files' || file.status !== null) && fuzzy(slice.filter, file.path) !== null
}

/**
 * After the tree changed shape — a reload, a search, another tab — the cursor
 * stays where it was when it can still be seen. Otherwise the file on screen,
 * brought into view; otherwise the first match of a search, or the first
 * change.
 */
function settle(slice: Slice): Slice {
  const { at, rows } = rowsOf(slice)
  if (at !== -1) return slice
  const opened = slice.files.find((file) => file.path === slice.opened)
  if (opened !== undefined && listed(slice, opened)) {
    return slice.filter === '' ? show(slice, opened.path) : { ...slice, cursor: `f:${opened.path}` }
  }
  if (slice.filter !== '') return land(slice, rows.find((row) => row.kind === 'file') ?? rows[0])
  const change = slice.tab === 'changes' ? nextChanged(slice.files, null, 1) : null
  return change === null ? land(slice, rows[0]) : show(slice, change)
}

function setFold(slice: Slice, path: string, open: boolean): Slice {
  const folds = slice.folds[slice.tab]
  return {
    ...slice,
    folds: { ...slice.folds, [slice.tab]: { ...folds, set: { ...folds.set, [path]: open } } },
  }
}

/** The folder row the cursor's row sits in, as drawn — a chain of folders is one row. */
function parentRow(rows: readonly Row[], row: Row): Row | undefined {
  const keys = new Set(rows.map((r) => r.key))
  const parent = ancestors(row.path)
    .toReversed()
    .find((path) => keys.has(`d:${path}`) && `d:${path}` !== row.key)
  return parent === undefined ? undefined : rows.find((r) => r.key === `d:${parent}`)
}

/** The first or last row of the folder the cursor is in: nvim-tree's `K` and `J`. */
function sibling(rows: readonly Row[], at: number, direction: 1 | -1): number {
  const depth = rows[at]?.depth ?? 0
  let found = at
  for (let i = at + direction; i >= 0 && i < rows.length; i += direction) {
    const row = rows[i] as Row
    if (row.depth < depth) break
    if (row.depth === depth) found = i
  }
  return found
}

export function reduce(
  slice: Slice = EMPTY,
  action: { actionId: string; payload?: unknown }
): Slice {
  switch (action.actionId) {
    case 'loading':
      return { ...slice, error: null, loading: true }
    case 'loaded': {
      const files = action.payload as RepoFile[]
      const anyChange = files.some((file) => file.status !== null)
      // The work when there is some — on arrival, or once the last change has
      // gone, the whole tree.
      let { tab } = slice
      if (slice.revision === 0) tab = anyChange ? 'changes' : 'files'
      else if (!anyChange) tab = 'files'
      return settle({ ...slice, files, loading: false, revision: slice.revision + 1, tab })
    }
    case 'failed':
      return { ...slice, error: action.payload as string, loading: false }
    case 'move': {
      const { at, rows } = rowsOf(slice)
      const target = Math.min(Math.max(at + (action.payload as number), 0), rows.length - 1)
      return land(slice, rows[target])
    }
    case 'edge': {
      // `gg` and `G`.
      const { rows } = rowsOf(slice)
      return land(slice, (action.payload as 1 | -1) === 1 ? rows.at(-1) : rows[0])
    }
    case 'sibling': {
      const { at, rows } = rowsOf(slice)
      return at === -1 ? slice : land(slice, rows[sibling(rows, at, action.payload as 1 | -1)])
    }
    case 'click': {
      // The mouse: a file is opened, a folder is opened or closed as well.
      const row = rowsOf(slice).rows[action.payload as number]
      const landed = { ...land(slice, row), focus: 'tree' as const }
      return row?.kind === 'dir' ? setFold(landed, row.path, !row.open) : landed
    }
    case 'open': {
      // `l` and ⏎: a folder opens or closes; a file takes the keys, to be read.
      const { at, rows } = rowsOf(slice)
      const row = rows[at]
      if (row?.kind === 'dir') return setFold(slice, row.path, !row.open)
      return row === undefined ? slice : { ...slice, focus: 'file' }
    }
    case 'close': {
      // `h`: shut the folder you are on, or go up to the one you are in.
      const { at, rows } = rowsOf(slice)
      const row = rows[at]
      if (row === undefined) return slice
      if (row.kind === 'dir' && row.open) return setFold(slice, row.path, false)
      const parent = parentRow(rows, row)
      return parent === undefined ? slice : land(slice, parent)
    }
    case 'parent': {
      // `P` goes up; `⌫` goes up and shuts the folder behind it.
      const { at, rows } = rowsOf(slice)
      const row = rows[at]
      const parent = row === undefined ? undefined : parentRow(rows, row)
      if (parent === undefined) return slice
      const landed = land(slice, parent)
      return action.payload === 'close' ? setFold(landed, parent.path, false) : landed
    }
    case 'focus':
      return { ...slice, focus: action.payload as Slice['focus'] }
    case 'tab':
      return settle({ ...slice, tab: slice.tab === 'changes' ? 'files' : 'changes' })
    case 'collapseAll': {
      // `W`: every folder shut, the cursor on the top-level one it was in.
      const top = slice.cursor === null ? undefined : ancestors(slice.cursor.slice(2))[0]
      const folds = { ...slice.folds, [slice.tab]: { open: false, set: {} } }
      const next = { ...slice, folds }
      const { rows } = rowsOf(next)
      const row = rows.find(
        (r) => r.kind === 'dir' && (r.path === top || r.path.startsWith(`${top}/`))
      )
      return row === undefined ? settle(next) : land(next, row)
    }
    case 'expandAll':
      // `E`: every folder open — in the whole tree, thousands of rows, which
      // only the rows on screen being drawn makes affordable.
      return settle({ ...slice, folds: { ...slice.folds, [slice.tab]: { open: true, set: {} } } })
    case 'filter':
      return settle({ ...slice, filter: action.payload as string })
    case 'jump': {
      const path = nextChanged(slice.files, slice.opened, action.payload as 1 | -1)
      if (path === null) return slice
      // A search that hides the change gives way: `]` is a promise to land on it.
      const hidden = fuzzy(slice.filter, path) === null
      return show(hidden ? { ...slice, filter: '' } : slice, path)
    }
    case 'prefer':
      return { ...slice, prefer: slice.prefer === 'diff' ? 'file' : 'diff' }
    case 'markdown':
      return { ...slice, markdown: slice.markdown === 'rendered' ? 'source' : 'rendered' }
    default:
      return slice
  }
}

/** Lines added and removed across every changed file, for the header. */
export function totals(files: readonly RepoFile[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const file of files) {
    added += file.added ?? 0
    removed += file.removed ?? 0
  }
  return { added, removed }
}

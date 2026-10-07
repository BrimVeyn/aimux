/**
 * The repository as a tree, from the flat list git hands over. Pure, so the
 * walking rules — which folder shows what, where `]` lands — are tested
 * without a screen.
 *
 * Built once per listing and kept: a keypress walks the folders that are
 * open, never the twenty thousand files of a large repository.
 */

export interface RepoFile {
  path: string
  /** `M`, `A`, `D`, `R`, `?`… or null for a file exactly as HEAD has it. */
  status: string | null
  added: number | null
  removed: number | null
}

/**
 * Two ways to look at the same repository, as neo-tree has its sources:
 * `changes` is the work — every changed file, folders open — and `files` the
 * whole tree, folders closed.
 */
export type Tab = 'changes' | 'files'

/** One tab's folders: whether a folder starts open, and those set by hand. */
export interface Folds {
  open: boolean
  set: Readonly<Record<string, boolean>>
}

export interface TreeView {
  tab: Tab
  folds: Readonly<Record<Tab, Folds>>
  /** A fuzzy query over paths. Empty shows the tree. */
  filter: string
}

export const DEFAULT_FOLDS: Readonly<Record<Tab, Folds>> = {
  changes: { open: true, set: {} },
  files: { open: false, set: {} },
}

export type Row =
  | {
      changed: boolean
      depth: number
      /** `│ ├ └`, the lines that tie a row to its folder. */
      guide: string
      key: string
      kind: 'dir'
      /** One folder, or a chain of folders that hold nothing else: `src/main/java`. */
      name: string
      open: boolean
      path: string
    }
  | {
      added: number | null
      depth: number
      guide: string
      key: string
      kind: 'file'
      /** Characters of `name` the search matched. */
      match: readonly number[]
      name: string
      path: string
      removed: number | null
      status: string | null
    }

interface Node {
  changed: boolean
  dirs: Node[]
  files: RepoFile[]
  name: string
  path: string
}

interface Index {
  /** Every file. */
  all: Node
  /** Only what changed, in the same shape. */
  changes: Node
  /** Changed paths in tree order, for `]` and `[`. */
  changed: string[]
}

const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name)

/** Folders first, then files, each by name — what every file browser does. */
function build(files: readonly RepoFile[]): Node {
  const root: Node = { changed: false, dirs: [], files: [], name: '', path: '' }
  const dirs = new Map<string, Node>([['', root]])
  for (const file of files) {
    let dir = root
    if (file.status !== null) dir.changed = true
    const parts = file.path.split('/')
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join('/')
      let next = dirs.get(path)
      if (next === undefined) {
        next = { changed: false, dirs: [], files: [], name: parts[i] as string, path }
        dirs.set(path, next)
        dir.dirs.push(next)
      }
      if (file.status !== null) next.changed = true
      dir = next
    }
    dir.files.push(file)
  }
  for (const node of dirs.values()) {
    node.dirs.sort(byName)
    node.files.sort((a, b) => a.path.localeCompare(b.path))
  }
  return root
}

function changedOrder(node: Node, out: string[] = []): string[] {
  for (const dir of node.dirs) changedOrder(dir, out)
  for (const file of node.files) out.push(file.path)
  return out
}

/** Keyed on the listing itself: a new listing is a new array, so a stale index cannot be read. */
const INDEXES = new WeakMap<readonly RepoFile[], Index>()

function indexOf(files: readonly RepoFile[]): Index {
  let index = INDEXES.get(files)
  if (index === undefined) {
    const changes = build(files.filter((file) => file.status !== null))
    index = { all: build(files), changed: changedOrder(changes), changes }
    INDEXES.set(files, index)
  }
  return index
}

/**
 * Where `query` falls in `text`, as fzf matches: its characters in order, not
 * necessarily together. Taken from the end, so a match lands in the file's
 * name rather than scattered over the folders before it. Ignores case unless
 * the query has a capital. Null when it does not match.
 */
export function fuzzy(query: string, text: string): number[] | null {
  const q = query.replaceAll(' ', '')
  if (q === '') return []
  const sensitive = q !== q.toLowerCase()
  const needle = sensitive ? q : q.toLowerCase()
  const hay = sensitive ? text : text.toLowerCase()
  const at: number[] = []
  let j = needle.length - 1
  for (let i = hay.length - 1; i >= 0 && j >= 0; i--) {
    if (hay[i] === needle[j]) {
      at.push(i)
      j--
    }
  }
  return j < 0 ? at.reverse() : null
}

/** The last search's tree, kept for the keypresses that follow it. */
let filtered: { files: readonly RepoFile[]; tab: Tab; query: string; root: Node } | null = null

function searched(files: readonly RepoFile[], tab: Tab, query: string): Node {
  if (filtered?.files === files && filtered.tab === tab && filtered.query === query) {
    return filtered.root
  }
  const pool = tab === 'changes' ? files.filter((file) => file.status !== null) : files
  const root = build(pool.filter((file) => fuzzy(query, file.path) !== null))
  filtered = { files, query, root, tab }
  return root
}

export function isOpen(view: TreeView, path: string): boolean {
  const folds = view.folds[view.tab]
  return folds.set[path] ?? folds.open
}

/** The rows on screen, top to bottom. A search shows every match, every folder open. */
export function visibleRows(files: readonly RepoFile[], view: TreeView): Row[] {
  const index = indexOf(files)
  const searching = view.filter.replaceAll(' ', '') !== ''
  let root = view.tab === 'changes' ? index.changes : index.all
  if (searching) root = searched(files, view.tab, view.filter)
  const rows: Row[] = []
  const walk = (node: Node, depth: number, prefix: string): void => {
    const count = node.dirs.length + node.files.length
    let i = 0
    for (const first of node.dirs) {
      const last = ++i === count
      // A folder holding one folder and nothing else is one step, not two:
      // `src/main/java` is a single row to open.
      let dir = first
      let name = first.name
      while (dir.dirs.length === 1 && dir.files.length === 0) {
        dir = dir.dirs[0] as Node
        name = `${name}/${dir.name}`
      }
      const open = searching || isOpen(view, dir.path)
      rows.push({
        changed: dir.changed,
        depth,
        guide: depth === 0 ? '' : `${prefix}${last ? '└ ' : '├ '}`,
        key: `d:${dir.path}`,
        kind: 'dir',
        name,
        open,
        path: dir.path,
      })
      if (open) walk(dir, depth + 1, depth === 0 ? '' : `${prefix}${last ? '  ' : '│ '}`)
    }
    for (const file of node.files) {
      const last = ++i === count
      const offset = node.path === '' ? 0 : node.path.length + 1
      const match = searching ? (fuzzy(view.filter, file.path) ?? []) : []
      rows.push({
        added: file.added,
        depth,
        guide: depth === 0 ? '' : `${prefix}${last ? '└ ' : '├ '}`,
        key: `f:${file.path}`,
        kind: 'file',
        match: match.filter((at) => at >= offset).map((at) => at - offset),
        name: file.path.slice(offset),
        path: file.path,
        removed: file.removed,
        status: file.status,
      })
    }
  }
  walk(root, 0, '')
  return rows
}

/** How many files a search matches in the tab — the rows alone also count folders. */
export function matchCount(files: readonly RepoFile[], view: TreeView): number {
  const count = (node: Node): number =>
    node.files.length + node.dirs.reduce((sum, dir) => sum + count(dir), 0)
  const index = indexOf(files)
  if (view.filter.replaceAll(' ', '') === '') {
    return view.tab === 'changes' ? index.changed.length : files.length
  }
  return count(searched(files, view.tab, view.filter))
}

/** `a/b/c.ts` → `['a', 'a/b']`: the folders that lead to it. */
export function ancestors(path: string): string[] {
  const parts = path.split('/').slice(0, -1)
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'))
}

/** The tab's folds with every folder on the way to `path` open. */
export function reveal(view: TreeView, path: string): Readonly<Record<Tab, Folds>> {
  const folds = view.folds[view.tab]
  const set = { ...folds.set }
  for (const dir of ancestors(path)) set[dir] = true
  return { ...view.folds, [view.tab]: { ...folds, set } }
}

/** Every changed path, in tree order. */
export function changedPaths(files: readonly RepoFile[]): readonly string[] {
  return indexOf(files).changed
}

/**
 * The changed file after (or before) `from` in tree order, wrapping round.
 * `from` need not be changed itself — it is placed by name among the changes —
 * and closed folders count: the caller opens what it lands in.
 */
export function nextChanged(
  files: readonly RepoFile[],
  from: string | null,
  direction: 1 | -1
): string | null {
  const order = changedPaths(files)
  const n = order.length
  if (n === 0) return null
  const at = from === null ? -1 : order.indexOf(from)
  if (at !== -1) {
    if (n === 1) return null
    return order[(at + direction + n) % n] as string
  }
  if (from === null) return (direction === 1 ? order[0] : order[n - 1]) as string
  // Not a change: the first one past it in tree order, which compares paths
  // the way the tree sorts them.
  const before = order.filter((path) => treeOrder(path, from) < 0)
  if (direction === 1) return order[before.length % n] as string
  return (before.length === 0 ? order[n - 1] : before.at(-1)) as string
}

/** Two paths in the order the tree draws them: a folder's contents before its loose files. */
function treeOrder(a: string, b: string): number {
  const pa = a.split('/')
  const pb = b.split('/')
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    if (pa[i] === pb[i]) continue
    const aDir = i < pa.length - 1
    const bDir = i < pb.length - 1
    if (aDir !== bDir) return aDir ? -1 : 1
    return (pa[i] as string).localeCompare(pb[i] as string)
  }
  return pa.length - pb.length
}

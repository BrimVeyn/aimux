import type { AppState, GitFileEntry, GitFileListMode, GitFileSection } from './types'

const SECTION_ORDER: GitFileSection[] = ['historical', 'staged', 'unstaged', 'untracked']

interface GitTreeNode {
  files: GitFileEntry[]
  folders: Map<string, GitTreeNode>
  path: string
  section: GitFileSection
}

export interface GitTreeFolderRow {
  kind: 'folder'
  key: string
  section: GitFileSection
  depth: number
  name: string
  folderPath: string
  parentKey?: string
  isCollapsed: boolean
}

export interface GitTreeFileRow {
  kind: 'file'
  key: string
  section: GitFileSection
  depth: number
  file: GitFileEntry
  parentKey?: string
}

export type GitTreeRow = GitTreeFolderRow | GitTreeFileRow

export interface GitTreeSectionRows {
  section: GitFileSection
  files: GitFileEntry[]
  rows: GitTreeRow[]
}

export interface GitTreeRows {
  sections: GitTreeSectionRows[]
  visibleRows: GitTreeRow[]
}

export function gitFileKey(
  file: Pick<GitFileEntry, 'path' | 'section'> & { repoPath?: string }
): string {
  return file.repoPath != null && file.repoPath !== ''
    ? `${file.section}:${file.repoPath}:${file.path}`
    : `${file.section}:${file.path}`
}

let lastFilter: { files: GitFileEntry[]; filter: string; out: GitFileEntry[] } | null = null

/**
 * Files whose path contains `filter`, ignoring case. An empty filter keeps them
 * all. The last answer is kept, and handed back as the same array, so the tree
 * built from it is not built again on the next keypress.
 */
export function filterGitFiles(files: GitFileEntry[], filter: string | null): GitFileEntry[] {
  if (filter == null || filter === '') return files
  if (lastFilter?.files === files && lastFilter.filter === filter) return lastFilter.out
  const lower = filter.toLowerCase()
  const out = files.filter((file) => file.path.toLowerCase().includes(lower))
  lastFilter = { files, filter, out }
  return out
}

/**
 * The filter the diff sidebar is showing: the draft while the filter bar is
 * open, so the list narrows as you type, and the applied one otherwise.
 */
export function activeGitFileFilter(state: Pick<AppState, 'gitMode' | 'modal'>): string {
  if (state.modal.type === 'git-file-filter') return state.modal.editBuffer ?? ''
  return state.gitMode.fileFilter
}

/** The files git mode lists, navigates and selects among. */
export function gitModeVisibleFiles(
  state: Pick<AppState, 'gitMode' | 'gitPanel' | 'modal'>
): GitFileEntry[] {
  return filterGitFiles(state.gitPanel.files, activeGitFileFilter(state))
}

export function gitFolderKey(section: GitFileSection, folderPath: string): string {
  return `${section}:dir:${folderPath}`
}

let lastTree: {
  files: GitFileEntry[]
  collapsedFolders: Record<string, true>
  fileListMode: GitFileListMode
  compact: boolean
  rows: GitTreeRows
} | null = null

/**
 * The sidebar's rows. Every git mode keypress asks for them — the reducer to
 * move the cursor, the panel to draw it — from inputs a cursor move leaves
 * alone, so the last answer is kept: with thousands of changes, sorting them
 * into a tree on every `j` is most of what the key costs.
 */
export function buildGitTreeRows(
  files: GitFileEntry[],
  collapsedFolders: Record<string, true>,
  fileListMode: GitFileListMode = 'tree',
  compact: boolean = false
): GitTreeRows {
  if (
    lastTree?.files === files &&
    lastTree.collapsedFolders === collapsedFolders &&
    lastTree.fileListMode === fileListMode &&
    lastTree.compact === compact
  ) {
    return lastTree.rows
  }
  const rows = buildTreeRows(files, collapsedFolders, fileListMode, compact)
  lastTree = { collapsedFolders, compact, fileListMode, files, rows }
  return rows
}

function buildTreeRows(
  files: GitFileEntry[],
  collapsedFolders: Record<string, true>,
  fileListMode: GitFileListMode,
  compact: boolean
): GitTreeRows {
  const sections = SECTION_ORDER.map((section) => {
    const sectionFiles = files.filter((file) => file.section === section)
    return {
      files: sectionFiles,
      rows:
        fileListMode === 'flat'
          ? sectionFiles.map((file) => ({
              depth: 0,
              file,
              key: gitFileKey(file),
              kind: 'file' as const,
              section,
            }))
          : flattenSectionRows(sectionFiles, collapsedFolders, compact),
      section,
    }
  })
  return { sections, visibleRows: sections.flatMap((section) => section.rows) }
}

export function getSelectedGitRow(
  files: GitFileEntry[],
  options: {
    collapsedFolders: Record<string, true>
    fileListMode: GitFileListMode
    selectedEntryKey: string | null
    compact?: boolean
  }
): GitTreeRow | null {
  if (!(options.selectedEntryKey != null && options.selectedEntryKey !== '')) return null
  const { visibleRows } = buildGitTreeRows(
    files,
    options.collapsedFolders,
    options.fileListMode,
    options.compact ?? false
  )
  return visibleRows.find((row) => row.key === options.selectedEntryKey) ?? null
}

export function getSelectedGitFile(
  files: GitFileEntry[],
  options: {
    collapsedFolders: Record<string, true>
    fileListMode: GitFileListMode
    selectedEntryKey: string | null
    compact?: boolean
  }
): GitFileEntry | null {
  const row = getSelectedGitRow(files, options)
  return row?.kind === 'file' ? row.file : null
}

/**
 * Where the selection goes when the list changes under it. A row that is still
 * there keeps it. One that went — a file discarded, staged into another
 * section, filtered out — hands it to its neighbour in the list as it was
 * (`previousKeys`): the next row that survived, else the one before it. The
 * top of the list is the last resort, not the answer: deleting the file you
 * are on must not throw you back to the first one.
 */
export function reconcileSelectedGitEntryKey(
  files: GitFileEntry[],
  collapsedFolders: Record<string, true>,
  fileListMode: GitFileListMode,
  selectedEntryKey: string | null | undefined,
  preferredKeys: string[] = [],
  compact: boolean = false,
  previousKeys: readonly string[] = []
): string | null {
  const { visibleRows } = buildGitTreeRows(files, collapsedFolders, fileListMode, compact)
  if (visibleRows.length === 0) return null
  const present = new Set(visibleRows.map((row) => row.key))
  const candidates = [...preferredKeys, selectedEntryKey ?? '']
  for (const key of candidates) {
    if (!key) continue
    if (present.has(key)) return key
  }
  const at = selectedEntryKey == null ? -1 : previousKeys.indexOf(selectedEntryKey)
  if (at !== -1) {
    // A file row first, either way: landing on a folder shows no diff.
    const after = previousKeys.slice(at + 1)
    const before = previousKeys.slice(0, at).reverse()
    const isFile = (key: string): boolean => !key.includes(':dir:')
    const neighbour =
      after.find((key) => present.has(key) && isFile(key)) ??
      before.find((key) => present.has(key) && isFile(key)) ??
      after.find((key) => present.has(key)) ??
      before.find((key) => present.has(key))
    if (neighbour !== undefined) return neighbour
  }
  return visibleRows[0]?.key ?? null
}

/** The keys of the rows the sidebar draws now, in order: what a neighbour is. */
export function visibleGitKeys(
  files: GitFileEntry[],
  collapsedFolders: Record<string, true>,
  fileListMode: GitFileListMode,
  compact: boolean = false
): string[] {
  return buildGitTreeRows(files, collapsedFolders, fileListMode, compact).visibleRows.map(
    (row) => row.key
  )
}

/**
 * Keeps git mode's selection on a row the sidebar still shows, after the files
 * or the filter changed. Returns the state untouched when it already is.
 */
export function reconcileGitSelection<S extends AppState>(state: S): S {
  const selectedEntryKey = reconcileSelectedGitEntryKey(
    gitModeVisibleFiles(state),
    state.gitMode.collapsedFolders,
    state.gitPane.fileListMode,
    state.gitMode.selectedEntryKey,
    [],
    state.gitPane.treeCompaction
  )
  if (selectedEntryKey === state.gitMode.selectedEntryKey) return state
  return { ...state, gitMode: { ...state.gitMode, pendingDeletePath: null, selectedEntryKey } }
}

export function moveGitSelection(
  files: GitFileEntry[],
  collapsedFolders: Record<string, true>,
  fileListMode: GitFileListMode,
  selectedEntryKey: string | null,
  delta: -1 | 1,
  compact: boolean = false
): string | null {
  const { visibleRows } = buildGitTreeRows(files, collapsedFolders, fileListMode, compact)
  const total = visibleRows.length
  if (total === 0) return null
  const current = visibleRows.findIndex((row) => row.key === selectedEntryKey)
  const base = current >= 0 ? current : 0
  return visibleRows[(base + delta + total) % total]?.key ?? null
}

export function moveGitFileSelection(
  files: GitFileEntry[],
  collapsedFolders: Record<string, true>,
  fileListMode: GitFileListMode,
  selectedEntryKey: string | null,
  delta: -1 | 1,
  compact: boolean = false
): string | null {
  const { visibleRows } = buildGitTreeRows(files, collapsedFolders, fileListMode, compact)
  const fileRows = visibleRows.filter((row) => row.kind === 'file')
  const total = fileRows.length
  if (total === 0) return null
  const current = fileRows.findIndex((row) => row.key === selectedEntryKey)
  let base = current
  if (base < 0) {
    base = delta > 0 ? -1 : 0
  }
  return fileRows[(base + delta + total) % total]?.key ?? null
}

function flattenSectionRows(
  files: GitFileEntry[],
  collapsedFolders: Record<string, true>,
  compact: boolean
): GitTreeRow[] {
  if (files.length === 0) return []
  const section = files[0]?.section
  if (!section) return []
  const root = buildSectionTree(files, section)
  return flattenTreeNode(root, collapsedFolders, 0, undefined, compact)
}

function buildSectionTree(files: GitFileEntry[], section: GitFileSection): GitTreeNode {
  const root: GitTreeNode = { files: [], folders: new Map(), path: '', section }
  for (const file of files) {
    const parts = file.path.split('/')
    let cursor = root
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i]
      if (!(name != null && name !== '')) continue
      const nextPath = cursor.path ? `${cursor.path}/${name}` : name
      let child = cursor.folders.get(name)
      if (!child) {
        child = { files: [], folders: new Map(), path: nextPath, section }
        cursor.folders.set(name, child)
      }
      cursor = child
    }
    cursor.files.push(file)
  }
  return root
}

function flattenTreeNode(
  node: GitTreeNode,
  collapsedFolders: Record<string, true>,
  depth: number,
  parentKey: string | undefined,
  compact: boolean
): GitTreeRow[] {
  const rows: GitTreeRow[] = []
  for (const child of node.folders.values()) {
    // Compaction: while a folder has exactly one child folder and no direct
    // files, fold the chain into a single row ("src/keymap/keymap.ts" instead
    // of three nested rows).
    let current = child
    const segments: string[] = [current.path.split('/').pop() ?? current.path]
    while (compact && current.files.length === 0 && current.folders.size === 1) {
      const next = current.folders.values().next().value
      if (!next) break
      segments.push(next.path.split('/').pop() ?? next.path)
      current = next
    }
    const name = segments.join('/')
    const key = gitFolderKey(node.section, current.path)
    const isCollapsed = key in collapsedFolders
    rows.push({
      depth,
      folderPath: current.path,
      isCollapsed,
      key,
      kind: 'folder',
      name,
      parentKey,
      section: node.section,
    })
    if (!isCollapsed) {
      rows.push(...flattenTreeNode(current, collapsedFolders, depth + 1, key, compact))
    }
  }
  for (const file of node.files) {
    rows.push({
      depth,
      file,
      key: gitFileKey(file),
      kind: 'file',
      parentKey,
      section: file.section,
    })
  }
  return rows
}

/**
 * `│ ├ └` for each row of a section, from the depths alone: the lines that tie
 * a row to its folder, two columns a level — the width the indent was. A
 * top-level row has none.
 *
 * Read backwards, so whether a row has a sibling still to come is known when
 * it is reached: `later[k]` says a row at depth `k` follows before anything
 * shallower closes that folder.
 */
export function treeGuides(rows: readonly { depth: number }[]): string[] {
  const guides: string[] = Array.from({ length: rows.length }, () => '')
  const later: boolean[] = []
  for (let i = rows.length - 1; i >= 0; i--) {
    const depth = rows[i]?.depth ?? 0
    let guide = ''
    for (let k = 1; k < depth; k++) guide += later[k] === true ? '│ ' : '  '
    if (depth > 0) guide += later[depth] === true ? '├ ' : '└ '
    guides[i] = guide
    later[depth] = true
    later.length = depth + 1
  }
  return guides
}

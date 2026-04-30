import type { GitFileEntry, GitFileListMode, GitFileSection } from './types'

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
  return file.repoPath
    ? `${file.section}:${file.repoPath}:${file.path}`
    : `${file.section}:${file.path}`
}

export function gitFolderKey(section: GitFileSection, folderPath: string): string {
  return `${section}:dir:${folderPath}`
}

export function buildGitTreeRows(
  files: GitFileEntry[],
  collapsedFolders: Record<string, true>,
  fileListMode: GitFileListMode = 'tree',
  compact: boolean = false
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
  if (!options.selectedEntryKey) return null
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

export function reconcileSelectedGitEntryKey(
  files: GitFileEntry[],
  collapsedFolders: Record<string, true>,
  fileListMode: GitFileListMode,
  selectedEntryKey: string | null | undefined,
  preferredKeys: string[] = [],
  compact: boolean = false
): string | null {
  const { visibleRows } = buildGitTreeRows(files, collapsedFolders, fileListMode, compact)
  if (visibleRows.length === 0) return null
  const candidates = [...preferredKeys, selectedEntryKey ?? '']
  for (const key of candidates) {
    if (!key) continue
    if (visibleRows.some((row) => row.key === key)) return key
  }
  return visibleRows[0]?.key ?? null
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
      if (!name) continue
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

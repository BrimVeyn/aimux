import { memo, type ReactNode, useCallback, useMemo } from 'react'

import type {
  GitFileEntry,
  GitFileListMode,
  GitFileSection,
  GitPaneDiffCountConfig,
  GitPanelState,
  GitPanePathConfig,
} from '../../../state/types'

import { useAppStore } from '../../../state/app-store'
import { dispatchGlobal, runSideEffectGlobal } from '../../../state/dispatch-ref'
import {
  buildGitTreeRows,
  type GitTreeFileRow,
  type GitTreeFolderRow,
  treeGuides,
} from '../../../state/git-tree'
import { fileIcon, folderIcon, type Icon } from '../../file-icons'
import { getCurrentTheme, useTheme } from '../../theme'
import { VirtualRows } from '../primitives/virtual-rows'

interface GitPanelProps {
  collapsedFolders?: Record<string, true>
  fileListMode?: GitFileListMode
  gitPanel: GitPanelState
  projectPath: string | undefined
  selectedEntryKey?: string | null
  pathConfig?: GitPanePathConfig
  diffCountConfig?: GitPaneDiffCountConfig
  headOffset?: number
  // When set, the single changed-files section is a workspace fork-point review
  // ("vs <base>") rather than a HEAD~N history walk.
  baseLabel?: string
  compact?: boolean
  // When false, suppress the inline tree|flat toggle on section headers and the
  // top ↑n ↓m remote-tracking line so a wrapper can own them at panel level.
  showFileListToggle?: boolean
  showRemoteTracking?: boolean
  // True when `gitPanel.files` is already narrowed by a filter, so an empty list
  // means nothing matched rather than a clean tree.
  filtered?: boolean
}

function sectionTitle(section: GitFileSection, headOffset: number, baseLabel?: string): string {
  switch (section) {
    case 'historical':
      return baseLabel != null && baseLabel !== '' ? baseLabel : `HEAD~${headOffset}`
    case 'staged':
      return 'Staged Changes'
    case 'unstaged':
      return 'Changes'
    case 'untracked':
      return 'Untracked'
  }
}

const BASE_SECTION_ORDER: GitFileSection[] = ['staged', 'unstaged', 'untracked']
const HISTORICAL_SECTION_ORDER: GitFileSection[] = ['historical', 'untracked']

function statusColor(status: GitFileEntry['status']): string {
  const t = getCurrentTheme()
  switch (status) {
    case '?':
      return t.text
    case 'A':
      return t.diffAdded
    case 'C':
    case 'R':
      return t.text
    case 'D':
    case 'U':
      return t.diffRemoved
    case 'M':
      return t.warning
  }
}

function displayStatus(file: GitFileEntry): string {
  if (file.section === 'untracked') return 'A'
  return file.status
}

function maxDigitWidth(files: GitFileEntry[]): { added: number; removed: number } {
  let addedMax = 1
  let removedMax = 1
  for (const f of files) {
    if (f.added !== null) addedMax = Math.max(addedMax, String(f.added).length)
    if (f.removed !== null) removedMax = Math.max(removedMax, String(f.removed).length)
  }
  return { added: addedMax, removed: removedMax }
}

function padRight(value: number | null, width: number): string {
  return String(value ?? 0).padStart(width, ' ')
}

function splitPath(path: string): { prefix: string; basename: string } {
  const slash = path.lastIndexOf('/')
  if (slash < 0) return { basename: path, prefix: '' }
  return { basename: path.slice(slash + 1), prefix: path.slice(0, slash + 1) }
}

function stripTrailingSlash(prefix: string): string {
  return prefix.endsWith('/') ? prefix.slice(0, -1) : prefix
}

function renderFileLabel(
  file: GitFileEntry,
  pathConfig: GitPanePathConfig,
  fileListMode: GitFileListMode,
  lead: ReactNode
): ReactNode {
  const t = getCurrentTheme()
  const transform = pathConfig.enabled ? pathConfig.pathFn : undefined
  const displayPath = transform ? transform(file.path) : file.path
  const { basename, prefix } = splitPath(displayPath)
  const dir = stripTrailingSlash(prefix)
  const showDir = fileListMode === 'flat' && pathConfig.enabled && dir !== ''
  if (!(file.renamedFrom != null && file.renamedFrom !== '')) {
    return (
      <text selectable={false} wrapMode="none">
        {lead}
        <span fg={t.text}>{basename}</span>
        {showDir ? <span fg={t.textMuted}> {dir}</span> : null}
      </text>
    )
  }
  const renamedDisplay = transform ? transform(file.renamedFrom) : file.renamedFrom
  const renamed = splitPath(renamedDisplay)
  const renamedDir = stripTrailingSlash(renamed.prefix)
  return (
    <text selectable={false} wrapMode="none">
      {lead}
      <span fg={t.textMuted}>{renamed.basename}</span>
      {showDir && renamedDir ? <span fg={t.textMuted}> {renamedDir}</span> : null}
      <span fg={t.textMuted}> → </span>
      <span fg={t.text}>{basename}</span>
      {showDir ? <span fg={t.textMuted}> {dir}</span> : null}
    </text>
  )
}

function renderDiffCount(
  file: GitFileEntry,
  addedW: number,
  removedW: number,
  bg: string | undefined,
  diffCountConfig: GitPaneDiffCountConfig,
  hasNumstat: boolean
): ReactNode {
  if (!diffCountConfig.enabled) return null
  const t = getCurrentTheme()
  if (!hasNumstat) {
    return (
      <text selectable={false} fg={t.textMuted} bg={bg} flexShrink={0}>
        —
      </text>
    )
  }
  return (
    <box flexDirection="row" flexShrink={0}>
      <text
        selectable={false}
        fg={getCurrentTheme().diffAdded}
        bg={bg}
      >{`+${padRight(file.added, addedW)}`}</text>
      <text selectable={false} fg={t.textMuted} bg={bg}>
        {' '}
      </text>
      <text
        selectable={false}
        fg={getCurrentTheme().diffRemoved}
        bg={bg}
      >{`−${padRight(file.removed, removedW)}`}</text>
    </box>
  )
}

/**
 * What leads a row's name: the guides that tie it to its folder, then its
 * icon. The guides take the two columns a level the indent used to.
 */
function Lead({ guide, icon }: { guide: string; icon: Icon | null }): ReactNode {
  const t = useTheme()
  return (
    <>
      {guide === '' ? null : <span fg={t.textMuted}>{guide}</span>}
      {icon === null ? null : <span fg={t[icon.tone]}>{`${icon.glyph} `}</span>}
    </>
  )
}

const FolderRow = memo(function FolderRow({
  guide,
  icons,
  isSelected,
  row,
}: {
  row: GitTreeFolderRow
  guide: string
  icons: boolean
  isSelected: boolean
}) {
  const t = useTheme()
  const bg = isSelected ? t.backgroundElement : undefined
  const onSelect = useCallback(() => {
    dispatchGlobal({ key: row.key, type: 'git-mode-select-entry-by-key' })
  }, [row.key])
  const onToggle = useCallback(() => {
    dispatchGlobal({ key: row.key, type: 'git-mode-toggle-folder' })
  }, [row.key])
  return (
    <box flexDirection="row" gap={1} backgroundColor={bg} onMouseDown={onSelect}>
      {/* The status column a file row has, left empty: without it a folder's
          guides start three columns left of its files' and the lines break. */}
      <box width={2} flexShrink={0} />
      <box flexGrow={1} overflow="hidden">
        <box flexDirection="row" onMouseDown={onToggle}>
          {/* With icons the folder's glyph says open or closed, as nvim-tree
              draws it; without, the arrow does. */}
          <text selectable={false} fg={t.textMuted} bg={bg} wrapMode="none">
            <Lead guide={guide} icon={icons ? folderIcon(!row.isCollapsed) : null} />
            {icons ? null : `${row.isCollapsed ? '▸' : '▾'} `}
            {row.name}
          </text>
        </box>
      </box>
    </box>
  )
})

const FileRow = memo(function FileRow({
  addedW,
  diffCountConfig,
  fileListMode,
  guide,
  icons,
  isSelected,
  pathConfig,
  removedW,
  repoPrefixes,
  row,
}: {
  row: GitTreeFileRow
  guide: string
  icons: boolean
  addedW: number
  removedW: number
  isSelected: boolean
  fileListMode: GitFileListMode
  pathConfig: GitPanePathConfig
  diffCountConfig: GitPaneDiffCountConfig
  repoPrefixes: Record<string, string>
}) {
  const t = useTheme()
  const file = row.file
  const hasNumstat = file.added !== null || file.removed !== null
  const bg = isSelected ? t.backgroundElement : undefined
  const onSelect = useCallback(() => {
    dispatchGlobal({ key: row.key, type: 'git-mode-select-entry-by-key' })
  }, [row.key])
  // Repo disambiguation prefix: only in flat mode, only when the file came
  // from a sub-repo (root repo files get an empty prefix).
  const repoTag =
    fileListMode === 'flat' && file.repoPath != null && file.repoPath !== ''
      ? (repoPrefixes[file.repoPath] ?? '')
      : ''
  return (
    <box flexDirection="row" gap={1} backgroundColor={bg} onMouseDown={onSelect}>
      <box width={2} flexShrink={0} justifyContent="center">
        <text selectable={false} fg={statusColor(file.status)} bg={bg}>
          <strong>{displayStatus(file)}</strong>
        </text>
      </box>
      {repoTag ? (
        <box flexShrink={0}>
          <text selectable={false} fg={t.primary} bg={bg}>
            <strong>{repoTag}</strong>
          </text>
        </box>
      ) : null}
      <box flexGrow={1} overflow="hidden">
        {renderFileLabel(
          file,
          pathConfig,
          fileListMode,
          <Lead guide={guide} icon={icons ? fileIcon(file.path) : null} />
        )}
      </box>
      {renderDiffCount(file, addedW, removedW, bg, diffCountConfig, hasNumstat)}
    </box>
  )
})

const SectionHeader = memo(function SectionHeader({
  count,
  fileListMode,
  showListModeToggle,
  title,
}: {
  title: string
  count: number
  fileListMode: GitFileListMode
  showListModeToggle: boolean
}) {
  const t2 = useTheme()
  const nextFileListMode = fileListMode === 'tree' ? 'flat' : 'tree'
  const toggleListMode = useCallback(() => {
    dispatchGlobal({ type: 'git-mode-toggle-file-list-mode' })
    runSideEffectGlobal({ mode: nextFileListMode, type: 'persist-git-file-list-mode' })
  }, [nextFileListMode])
  return (
    <box flexDirection="row" justifyContent="space-between">
      <text selectable={false} fg={t2.text}>
        <strong>
          {title} ({count})
        </strong>
      </text>
      {showListModeToggle ? (
        <box flexDirection="row" gap={1} onMouseDown={toggleListMode}>
          <text selectable={false} fg={fileListMode === 'tree' ? t2.primary : t2.textMuted}>
            tree
          </text>
          <text selectable={false} fg={t2.textMuted}>
            |
          </text>
          <text selectable={false} fg={fileListMode === 'flat' ? t2.primary : t2.textMuted}>
            flat
          </text>
        </box>
      ) : null}
    </box>
  )
})

/**
 * Every line of the panel, top to bottom: a blank line between sections, each
 * section's heading, then its rows. Flat, so only the lines on screen are
 * drawn — a working tree with thousands of changes is otherwise thousands of
 * rows laid out on every keypress.
 */
type PanelLine =
  | { kind: 'gap'; key: string }
  | { kind: 'header'; key: string; section: GitFileSection; count: number }
  | GitTreeFolderRow
  | GitTreeFileRow

/** The cursor stays in the middle of the panel, as it always has here. */
const CENTRED = 999

interface StatusPlaceholder {
  label: string
  labelColor: string
}

function renderStatus(
  gitPanel: GitPanelState,
  hasProjectPath: boolean,
  filtered: boolean
): ReactNode | null {
  const placeholder = computeStatusPlaceholder(gitPanel, hasProjectPath, filtered)
  if (!placeholder) return null
  return (
    <box flexGrow={1} flexDirection="column" alignItems="center" paddingTop={1}>
      <text selectable={false} fg={placeholder.labelColor}>
        {placeholder.label}
      </text>
    </box>
  )
}

function computeStatusPlaceholder(
  gitPanel: GitPanelState,
  hasProjectPath: boolean,
  filtered: boolean
): StatusPlaceholder | null {
  const t = getCurrentTheme()
  if (!hasProjectPath) {
    return { label: 'No active project', labelColor: t.textMuted }
  }
  if (gitPanel.error === 'not-a-repo') {
    return { label: 'Not a git repository', labelColor: t.textMuted }
  }
  if (gitPanel.error === 'unknown') {
    return { label: 'Git error', labelColor: t.error }
  }
  if (gitPanel.files.length === 0) {
    return { label: filtered ? 'No file matches' : 'Working tree clean', labelColor: t.textMuted }
  }
  return null
}

const DEFAULT_PATH_CONFIG: GitPanePathConfig = { enabled: true }
const DEFAULT_DIFF_COUNT_CONFIG: GitPaneDiffCountConfig = { enabled: true }

export const GitPanel = memo(function GitPanel({
  baseLabel,
  collapsedFolders = {},
  compact = false,
  diffCountConfig = DEFAULT_DIFF_COUNT_CONFIG,
  fileListMode = 'tree',
  filtered = false,
  gitPanel,
  headOffset = 0,
  pathConfig = DEFAULT_PATH_CONFIG,
  projectPath,
  selectedEntryKey,
  showFileListToggle = true,
  showRemoteTracking = true,
}: GitPanelProps) {
  const t = useTheme()
  const repoPrefixes = useAppStore((s) => s.multiRepo.prefixes)
  const icons = useAppStore((s) => s.gitPane.icons.enabled)
  const isSingleSection = headOffset > 0 || (baseLabel != null && baseLabel !== '')
  const sectionOrder = isSingleSection ? HISTORICAL_SECTION_ORDER : BASE_SECTION_ORDER
  const tree = useMemo(
    () => buildGitTreeRows(gitPanel.files, collapsedFolders, fileListMode, compact),
    [collapsedFolders, compact, fileListMode, gitPanel.files]
  )
  const { added: addedW, removed: removedW } = useMemo(
    () => maxDigitWidth(gitPanel.files),
    [gitPanel.files]
  )

  const statusNode = renderStatus(gitPanel, !!(projectPath != null && projectPath !== ''), filtered)

  const hasRemoteTracking = showRemoteTracking && (gitPanel.ahead > 0 || gitPanel.behind > 0)
  const toggleSection = showFileListToggle
    ? (tree.sections.find((section) => section.section === 'unstaged' && section.files.length > 0)
        ?.section ??
      tree.sections.find((section) => section.files.length > 0)?.section ??
      null)
    : null

  const lines = useMemo(() => {
    const out: PanelLine[] = []
    for (const key of sectionOrder) {
      const section = tree.sections.find((entry) => entry.section === key)
      if (section === undefined || section.files.length === 0) continue
      if (out.length > 0) out.push({ key: `gap:${key}`, kind: 'gap' })
      out.push({ count: section.files.length, key: `header:${key}`, kind: 'header', section: key })
      out.push(...section.rows)
    }
    return out
  }, [sectionOrder, tree.sections])
  const guides = useMemo(() => {
    const out = new Map<string, string>()
    if (fileListMode !== 'tree') return out
    for (const section of tree.sections) {
      const sectionGuides = treeGuides(section.rows)
      for (const [i, row] of section.rows.entries()) out.set(row.key, sectionGuides[i] ?? '')
    }
    return out
  }, [fileListMode, tree.sections])
  const cursor = useMemo(
    () => lines.findIndex((line) => line.key === selectedEntryKey),
    [lines, selectedEntryKey]
  )
  const keyOf = useCallback((index: number) => lines[index]?.key ?? String(index), [lines])
  const renderRow = useCallback(
    (index: number): ReactNode => {
      const line = lines[index]
      switch (line?.kind) {
        case undefined:
        case 'gap':
          return <box height={1} />
        case 'header':
          return (
            <SectionHeader
              title={sectionTitle(line.section, headOffset, baseLabel)}
              count={line.count}
              fileListMode={fileListMode}
              showListModeToggle={line.section === toggleSection}
            />
          )
        case 'folder':
          return (
            <FolderRow
              row={line}
              guide={guides.get(line.key) ?? ''}
              icons={icons}
              isSelected={line.key === selectedEntryKey}
            />
          )
        case 'file':
          return (
            <FileRow
              row={line}
              guide={guides.get(line.key) ?? ''}
              icons={icons}
              addedW={addedW}
              removedW={removedW}
              isSelected={line.key === selectedEntryKey}
              fileListMode={fileListMode}
              pathConfig={pathConfig}
              diffCountConfig={diffCountConfig}
              repoPrefixes={repoPrefixes}
            />
          )
      }
    },
    [
      addedW,
      baseLabel,
      diffCountConfig,
      fileListMode,
      guides,
      headOffset,
      icons,
      lines,
      pathConfig,
      removedW,
      repoPrefixes,
      selectedEntryKey,
      toggleSection,
    ]
  )

  return (
    <box flexDirection="column" flexGrow={1} flexShrink={1} flexBasis={0} overflow="hidden" gap={0}>
      {hasRemoteTracking ? (
        <text selectable={false} fg={t.textMuted}>
          ↑{gitPanel.ahead} ↓{gitPanel.behind}
        </text>
      ) : null}
      {statusNode ?? (
        <VirtualRows
          count={lines.length}
          cursor={cursor}
          keyOf={keyOf}
          renderRow={renderRow}
          scrolloff={CENTRED}
        />
      )}
    </box>
  )
})

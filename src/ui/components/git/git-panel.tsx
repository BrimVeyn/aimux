import type { ScrollBoxRenderable } from '@opentui/core'

import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef } from 'react'

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
} from '../../../state/git-tree'
import { getCurrentTheme, useTheme, useTransparent } from '../../theme'

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
  fileListMode: GitFileListMode
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

const FolderRow = memo(function FolderRow({
  isSelected,
  row,
}: {
  row: GitTreeFolderRow
  isSelected: boolean
}) {
  const t = useTheme()
  const transparent = useTransparent()
  const bg = isSelected && !transparent ? t.backgroundElement : undefined
  const onSelect = useCallback(() => {
    dispatchGlobal({ key: row.key, type: 'git-mode-select-entry-by-key' })
  }, [row.key])
  const onToggle = useCallback(() => {
    dispatchGlobal({ key: row.key, type: 'git-mode-toggle-folder' })
  }, [row.key])
  return (
    <box flexDirection="row" gap={1} backgroundColor={bg} onMouseDown={onSelect}>
      <box flexGrow={1} overflow="hidden" paddingLeft={row.depth * 2}>
        <box flexDirection="row" gap={1} onMouseDown={onToggle}>
          <text selectable={false} fg={t.textMuted} bg={bg}>
            {row.isCollapsed ? '▸' : '▾'}
          </text>
          <text selectable={false} fg={t.textMuted} bg={bg}>
            {row.isCollapsed ? '\uf07b' : '\uf07c'}
          </text>
          <text selectable={false} fg={t.textMuted} bg={bg} wrapMode="none">
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
  isSelected,
  pathConfig,
  removedW,
  repoPrefixes,
  row,
}: {
  row: GitTreeFileRow
  addedW: number
  removedW: number
  isSelected: boolean
  fileListMode: GitFileListMode
  pathConfig: GitPanePathConfig
  diffCountConfig: GitPaneDiffCountConfig
  repoPrefixes: Record<string, string>
}) {
  const t = useTheme()
  const transparent = useTransparent()
  const file = row.file
  const hasNumstat = file.added !== null || file.removed !== null
  const bg = isSelected && !transparent ? t.backgroundElement : undefined
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
      <box flexGrow={1} overflow="hidden" paddingLeft={fileListMode === 'tree' ? row.depth * 2 : 0}>
        {renderFileLabel(file, pathConfig, fileListMode)}
      </box>
      {renderDiffCount(file, addedW, removedW, bg, diffCountConfig, hasNumstat)}
    </box>
  )
})

const TreeSection = memo(function TreeSection({
  addedW,
  diffCountConfig,
  fileListMode,
  files,
  marginTop,
  pathConfig,
  removedW,
  repoPrefixes,
  rows,
  selectedEntryKey,
  showListModeToggle,
  title,
}: {
  title: string
  files: GitFileEntry[]
  rows: (GitTreeFolderRow | GitTreeFileRow)[]
  addedW: number
  removedW: number
  fileListMode: GitFileListMode
  selectedEntryKey: string | null | undefined
  showListModeToggle: boolean
  pathConfig: GitPanePathConfig
  diffCountConfig: GitPaneDiffCountConfig
  marginTop: number
  repoPrefixes: Record<string, string>
}) {
  const t2 = useTheme()
  const nextFileListMode = fileListMode === 'tree' ? 'flat' : 'tree'
  const toggleListMode = useCallback(() => {
    dispatchGlobal({ type: 'git-mode-toggle-file-list-mode' })
    runSideEffectGlobal({ mode: nextFileListMode, type: 'persist-git-file-list-mode' })
  }, [nextFileListMode])
  if (files.length === 0) return null
  return (
    <box flexDirection="column" marginTop={marginTop}>
      <box flexDirection="row" justifyContent="space-between">
        <text selectable={false} fg={t2.text}>
          <strong>
            {title} ({files.length})
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
      {rows.map((row) =>
        row.kind === 'folder' ? (
          <FolderRow key={row.key} row={row} isSelected={row.key === selectedEntryKey} />
        ) : (
          <FileRow
            key={row.key}
            row={row}
            addedW={addedW}
            removedW={removedW}
            isSelected={row.key === selectedEntryKey}
            fileListMode={fileListMode}
            pathConfig={pathConfig}
            diffCountConfig={diffCountConfig}
            repoPrefixes={repoPrefixes}
          />
        )
      )}
    </box>
  )
})

interface StatusPlaceholder {
  label: string
  labelColor: string
}

function renderStatus(gitPanel: GitPanelState, hasProjectPath: boolean): ReactNode | null {
  const placeholder = computeStatusPlaceholder(gitPanel, hasProjectPath)
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
  hasProjectPath: boolean
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
    return { label: 'Working tree clean', labelColor: t.textMuted }
  }
  return null
}

const DEFAULT_PATH_CONFIG: GitPanePathConfig = { enabled: true }
const DEFAULT_DIFF_COUNT_CONFIG: GitPaneDiffCountConfig = { enabled: true }
const HIDDEN_SCROLLBAR_OPTIONS = { visible: false }
const COLUMN_CONTENT_OPTIONS = { flexDirection: 'column' as const, gap: 0 }
const EMPTY_FILES: GitFileEntry[] = []
const EMPTY_ROWS: (GitTreeFolderRow | GitTreeFileRow)[] = []

export const GitPanel = memo(function GitPanel({
  baseLabel,
  collapsedFolders = {},
  compact = false,
  diffCountConfig = DEFAULT_DIFF_COUNT_CONFIG,
  fileListMode = 'tree',
  gitPanel,
  headOffset = 0,
  pathConfig = DEFAULT_PATH_CONFIG,
  projectPath,
  selectedEntryKey,
  showFileListToggle = true,
  showRemoteTracking = true,
}: GitPanelProps) {
  const t = useTheme()
  useTransparent()
  const repoPrefixes = useAppStore((s) => s.multiRepo.prefixes)
  const isSingleSection = headOffset > 0 || (baseLabel != null && baseLabel !== '')
  const sectionOrder = isSingleSection ? HISTORICAL_SECTION_ORDER : BASE_SECTION_ORDER
  const scrollRef = useRef<ScrollBoxRenderable | null>(null)
  const tree = useMemo(
    () => buildGitTreeRows(gitPanel.files, collapsedFolders, fileListMode, compact),
    [collapsedFolders, compact, fileListMode, gitPanel.files]
  )
  const { added: addedW, removed: removedW } = useMemo(
    () => maxDigitWidth(gitPanel.files),
    [gitPanel.files]
  )

  const statusNode = renderStatus(gitPanel, !!(projectPath != null && projectPath !== ''))

  const hasRemoteTracking = showRemoteTracking && (gitPanel.ahead > 0 || gitPanel.behind > 0)
  const toggleSection = showFileListToggle
    ? (tree.sections.find((section) => section.section === 'unstaged' && section.files.length > 0)
        ?.section ??
      tree.sections.find((section) => section.files.length > 0)?.section ??
      null)
    : null

  useEffect(() => {
    const scrollbox = scrollRef.current
    if (!scrollbox || !(selectedEntryKey != null && selectedEntryKey !== '')) return
    const selectedIndex = tree.visibleRows.findIndex((row) => row.key === selectedEntryKey)
    if (selectedIndex < 0) return
    const viewportHeight = Math.max(1, scrollbox.viewport.height)
    const target = Math.max(0, selectedIndex - Math.floor(viewportHeight / 2))
    scrollbox.scrollTo({ x: 0, y: target })
  }, [selectedEntryKey, tree.visibleRows])

  return (
    <box flexDirection="column" flexGrow={1} flexShrink={1} flexBasis={0} overflow="hidden" gap={0}>
      {hasRemoteTracking ? (
        <text selectable={false} fg={t.textMuted}>
          ↑{gitPanel.ahead} ↓{gitPanel.behind}
        </text>
      ) : null}
      {statusNode ?? (
        <scrollbox
          flexGrow={1}
          ref={scrollRef}
          scrollY
          scrollbarOptions={HIDDEN_SCROLLBAR_OPTIONS}
          viewportCulling
          contentOptions={COLUMN_CONTENT_OPTIONS}
        >
          {sectionOrder.map((key, idx) => {
            const section = tree.sections.find((entry) => entry.section === key)
            const priorHasFiles = sectionOrder
              .slice(0, idx)
              .some((k) => (tree.sections.find((e) => e.section === k)?.files.length ?? 0) > 0)
            return (
              <TreeSection
                key={key}
                title={sectionTitle(key, headOffset, baseLabel)}
                files={section?.files ?? EMPTY_FILES}
                rows={section?.rows ?? EMPTY_ROWS}
                addedW={addedW}
                removedW={removedW}
                fileListMode={fileListMode}
                selectedEntryKey={selectedEntryKey}
                showListModeToggle={key === toggleSection}
                pathConfig={pathConfig}
                diffCountConfig={diffCountConfig}
                marginTop={priorHasFiles ? 1 : 0}
                repoPrefixes={repoPrefixes}
              />
            )
          })}
        </scrollbox>
      )}
    </box>
  )
})

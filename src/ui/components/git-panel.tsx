import type { ScrollBoxRenderable } from '@opentui/core'

import { memo, type ReactNode, useEffect, useMemo, useRef } from 'react'

import type {
  GitFileEntry,
  GitFileListMode,
  GitFileSection,
  GitPaneDiffCountConfig,
  GitPanelState,
  GitPanePathConfig,
} from '../../state/types'

import { useAppStore } from '../../state/app-store'
import { dispatchGlobal, runSideEffectGlobal } from '../../state/dispatch-ref'
import { buildGitTreeRows, type GitTreeFileRow, type GitTreeFolderRow } from '../../state/git-tree'
import { getCurrentTheme, useTheme } from '../theme'
import { MagicWand } from './magic-wand'

interface GitPanelProps {
  collapsedFolders?: Record<string, true>
  fileListMode?: GitFileListMode
  gitPanel: GitPanelState
  projectPath: string | undefined
  selectedEntryKey?: string | null
  pathConfig?: GitPanePathConfig
  diffCountConfig?: GitPaneDiffCountConfig
  headOffset?: number
  compact?: boolean
}

function sectionTitle(section: GitFileSection, headOffset: number): string {
  switch (section) {
    case 'historical':
      return `HEAD~${headOffset}`
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
    case 'A':
      return t.colors['gitDecoration.addedResourceForeground']
    case 'C':
    case 'R':
      return t.colors['textLink.foreground']
    case 'D':
    case 'U':
      return t.colors['editorError.foreground']
    case 'M':
      return t.colors['editorWarning.foreground']
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
  const transform = pathConfig.enabled ? pathConfig.pathFn : undefined
  const displayPath = transform ? transform(file.path) : file.path
  const { basename, prefix } = splitPath(displayPath)
  const dir = stripTrailingSlash(prefix)
  const showDir = fileListMode === 'flat' && pathConfig.enabled && dir
  if (!file.renamedFrom) {
    return (
      <text wrapMode="none">
        <span fg={getCurrentTheme().colors['editor.foreground']}>{basename}</span>
        {showDir ? (
          <span fg={getCurrentTheme().colors['descriptionForeground']}> {dir}</span>
        ) : null}
      </text>
    )
  }
  const renamedDisplay = transform ? transform(file.renamedFrom) : file.renamedFrom
  const renamed = splitPath(renamedDisplay)
  const renamedDir = stripTrailingSlash(renamed.prefix)
  return (
    <text wrapMode="none">
      <span fg={getCurrentTheme().colors['descriptionForeground']}>{renamed.basename}</span>
      {showDir && renamedDir ? (
        <span fg={getCurrentTheme().colors['descriptionForeground']}> {renamedDir}</span>
      ) : null}
      <span fg={getCurrentTheme().colors['descriptionForeground']}> → </span>
      <span fg={getCurrentTheme().colors['editor.foreground']}>{basename}</span>
      {showDir ? <span fg={getCurrentTheme().colors['descriptionForeground']}> {dir}</span> : null}
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
  if (!hasNumstat) {
    return (
      <text fg={getCurrentTheme().colors['descriptionForeground']} bg={bg} flexShrink={0}>
        —
      </text>
    )
  }
  return (
    <box flexDirection="row" flexShrink={0}>
      <text
        fg={getCurrentTheme().colors['gitDecoration.addedResourceForeground']}
        bg={bg}
      >{`+${padRight(file.added, addedW)}`}</text>
      <text fg={getCurrentTheme().colors['editor.lineHighlightBackground']} bg={bg}>
        {' '}
      </text>
      <text
        fg={getCurrentTheme().colors['editorError.foreground']}
        bg={bg}
      >{`−${padRight(file.removed, removedW)}`}</text>
    </box>
  )
}

function renderFolderRow(row: GitTreeFolderRow, isSelected: boolean): ReactNode {
  const bg = isSelected ? getCurrentTheme().colors['list.activeSelectionBackground'] : undefined
  const onSelect = (): void => {
    dispatchGlobal({ key: row.key, type: 'git-mode-select-entry-by-key' })
  }
  const onToggle = (): void => {
    dispatchGlobal({ key: row.key, type: 'git-mode-toggle-folder' })
  }
  return (
    <box key={row.key} flexDirection="row" gap={1} backgroundColor={bg} onMouseDown={onSelect}>
      <box flexGrow={1} overflow="hidden" paddingLeft={row.depth * 2}>
        <box flexDirection="row" gap={1} onMouseDown={onToggle}>
          <text fg={getCurrentTheme().colors['descriptionForeground']} bg={bg}>
            {row.isCollapsed ? '▸' : '▾'}
          </text>
          <text fg={getCurrentTheme().colors['textLink.foreground']} bg={bg}>
            {row.isCollapsed ? '\uf07b' : '\uf07c'}
          </text>
          <text fg={getCurrentTheme().colors['textLink.foreground']} bg={bg} wrapMode="none">
            {row.name}
          </text>
        </box>
      </box>
    </box>
  )
}

function renderFileRow(
  row: GitTreeFileRow,
  addedW: number,
  removedW: number,
  isSelected: boolean,
  fileListMode: GitFileListMode,
  pathConfig: GitPanePathConfig,
  diffCountConfig: GitPaneDiffCountConfig
): ReactNode {
  const file = row.file
  const hasNumstat = file.added !== null || file.removed !== null
  const bg = isSelected ? getCurrentTheme().colors['list.activeSelectionBackground'] : undefined
  const onSelect = (): void => {
    dispatchGlobal({ key: row.key, type: 'git-mode-select-entry-by-key' })
  }
  return (
    <box key={row.key} flexDirection="row" gap={1} backgroundColor={bg} onMouseDown={onSelect}>
      <box width={2} flexShrink={0} justifyContent="center">
        <text fg={statusColor(file.status)} bg={bg}>
          <strong>{displayStatus(file)}</strong>
        </text>
      </box>
      <box flexGrow={1} overflow="hidden" paddingLeft={fileListMode === 'tree' ? row.depth * 2 : 0}>
        {renderFileLabel(file, pathConfig, fileListMode)}
      </box>
      {renderDiffCount(file, addedW, removedW, bg, diffCountConfig, hasNumstat)}
    </box>
  )
}

function renderTreeSection(
  section: GitFileSection,
  title: string,
  files: GitFileEntry[],
  rows: Array<GitTreeFolderRow | GitTreeFileRow>,
  addedW: number,
  removedW: number,
  fileListMode: GitFileListMode,
  selectedEntryKey: string | null | undefined,
  showListModeToggle: boolean,
  pathConfig: GitPanePathConfig,
  diffCountConfig: GitPaneDiffCountConfig,
  marginTop: number,
  wandSlot: ReactNode | null
): ReactNode {
  if (files.length === 0) return null
  const nextFileListMode = fileListMode === 'tree' ? 'flat' : 'tree'
  const toggleListMode = (): void => {
    dispatchGlobal({ type: 'git-mode-toggle-file-list-mode' })
    runSideEffectGlobal({ mode: nextFileListMode, type: 'persist-git-file-list-mode' })
  }
  return (
    <box key={section} flexDirection="column" marginTop={marginTop}>
      <box flexDirection="row" justifyContent="space-between">
        <box flexDirection="row" gap={1}>
          <text fg={getCurrentTheme().colors['terminal.ansiMagenta']}>
            <strong>
              {title} ({files.length})
            </strong>
          </text>
          {wandSlot}
        </box>
        {showListModeToggle ? (
          <box flexDirection="row" gap={1} onMouseDown={toggleListMode}>
            <text
              fg={
                fileListMode === 'tree'
                  ? getCurrentTheme().colors['textLink.foreground']
                  : getCurrentTheme().colors['descriptionForeground']
              }
            >
              tree
            </text>
            <text fg={getCurrentTheme().colors['descriptionForeground']}>|</text>
            <text
              fg={
                fileListMode === 'flat'
                  ? getCurrentTheme().colors['textLink.foreground']
                  : getCurrentTheme().colors['descriptionForeground']
              }
            >
              flat
            </text>
          </box>
        ) : null}
      </box>
      {rows.map((row) =>
        row.kind === 'folder'
          ? renderFolderRow(row, row.key === selectedEntryKey)
          : renderFileRow(
              row,
              addedW,
              removedW,
              row.key === selectedEntryKey,
              fileListMode,
              pathConfig,
              diffCountConfig
            )
      )}
    </box>
  )
}

interface StatusPlaceholder {
  label: string
  labelColor: string
}

function renderStatus(gitPanel: GitPanelState, hasProjectPath: boolean): ReactNode | null {
  const placeholder = computeStatusPlaceholder(gitPanel, hasProjectPath)
  if (!placeholder) return null
  return (
    <box flexGrow={1} flexDirection="column" alignItems="center" paddingTop={1}>
      <text fg={placeholder.labelColor}>{placeholder.label}</text>
    </box>
  )
}

function computeStatusPlaceholder(
  gitPanel: GitPanelState,
  hasProjectPath: boolean
): StatusPlaceholder | null {
  if (!hasProjectPath) {
    return {
      label: 'No active session',
      labelColor: getCurrentTheme().colors['descriptionForeground'],
    }
  }
  if (gitPanel.error === 'not-a-repo') {
    return {
      label: 'Not a git repository',
      labelColor: getCurrentTheme().colors['descriptionForeground'],
    }
  }
  if (gitPanel.error === 'unknown') {
    return { label: 'Git error', labelColor: getCurrentTheme().colors['editorError.foreground'] }
  }
  if (gitPanel.files.length === 0) {
    return {
      label: 'Working tree clean',
      labelColor: getCurrentTheme().colors['descriptionForeground'],
    }
  }
  return null
}

const DEFAULT_PATH_CONFIG: GitPanePathConfig = { enabled: true }
const DEFAULT_DIFF_COUNT_CONFIG: GitPaneDiffCountConfig = { enabled: true }

export const GitPanel = memo(function GitPanel({
  collapsedFolders = {},
  compact = false,
  diffCountConfig = DEFAULT_DIFF_COUNT_CONFIG,
  fileListMode = 'tree',
  gitPanel,
  headOffset = 0,
  pathConfig = DEFAULT_PATH_CONFIG,
  projectPath,
  selectedEntryKey,
}: GitPanelProps) {
  const theme = useTheme()
  const sectionOrder = headOffset > 0 ? HISTORICAL_SECTION_ORDER : BASE_SECTION_ORDER
  const currentSessionId = useAppStore((s) => s.currentSessionId)
  const autoCommitSuggestion = useAppStore((s) =>
    currentSessionId ? s.autoCommit.bySession[currentSessionId] : undefined
  )
  const wandReady = autoCommitSuggestion?.kind === 'ready'
  const wandSlot =
    wandReady && currentSessionId ? (
      <MagicWand
        onClick={() => {
          dispatchGlobal({ sessionId: currentSessionId, type: 'open-auto-commit-modal' })
        }}
      />
    ) : null
  const scrollRef = useRef<ScrollBoxRenderable | null>(null)
  const tree = useMemo(
    () => buildGitTreeRows(gitPanel.files, collapsedFolders, fileListMode, compact),
    [collapsedFolders, compact, fileListMode, gitPanel.files]
  )
  const { added: addedW, removed: removedW } = useMemo(
    () => maxDigitWidth(gitPanel.files),
    [gitPanel.files]
  )

  const statusNode = renderStatus(gitPanel, !!projectPath)

  const hasRemoteTracking = gitPanel.ahead > 0 || gitPanel.behind > 0
  const toggleSection =
    tree.sections.find((section) => section.section === 'unstaged' && section.files.length > 0)
      ?.section ??
    tree.sections.find((section) => section.files.length > 0)?.section ??
    null

  useEffect(() => {
    const scrollbox = scrollRef.current
    if (!scrollbox || !selectedEntryKey) return
    const selectedIndex = tree.visibleRows.findIndex((row) => row.key === selectedEntryKey)
    if (selectedIndex < 0) return
    const viewportHeight = Math.max(1, scrollbox.viewport.height)
    const target = Math.max(0, selectedIndex - Math.floor(viewportHeight / 2))
    scrollbox.scrollTo({ x: 0, y: target })
  }, [selectedEntryKey, tree.visibleRows])

  return (
    <box flexDirection="column" flexGrow={1} gap={0}>
      {hasRemoteTracking ? (
        <text fg={theme.colors['descriptionForeground']}>
          ↑{gitPanel.ahead} ↓{gitPanel.behind}
        </text>
      ) : null}
      {statusNode ?? (
        <scrollbox
          flexGrow={1}
          ref={scrollRef}
          scrollY
          scrollbarOptions={{ visible: false }}
          viewportCulling
          contentOptions={{ flexDirection: 'column', gap: 0 }}
        >
          {sectionOrder.map((key, idx) => {
            const section = tree.sections.find((entry) => entry.section === key)
            const priorHasFiles = sectionOrder
              .slice(0, idx)
              .some((k) => (tree.sections.find((e) => e.section === k)?.files.length ?? 0) > 0)
            return renderTreeSection(
              key,
              sectionTitle(key, headOffset),
              section?.files ?? [],
              section?.rows ?? [],
              addedW,
              removedW,
              fileListMode,
              selectedEntryKey,
              key === toggleSection,
              pathConfig,
              diffCountConfig,
              priorHasFiles ? 1 : 0,
              key === 'untracked' ? wandSlot : null
            )
          })}
        </scrollbox>
      )}
    </box>
  )
})

import { memo, type ReactNode, useMemo } from 'react'

import type { GitFileEntry, GitFileSection, GitPanelState } from '../../state/types'

import { theme } from '../theme'

interface GitPanelProps {
  gitPanel: GitPanelState
  projectPath: string | undefined
  selectedFileKey?: string | null
}

export function fileKey(file: Pick<GitFileEntry, 'path' | 'section'>): string {
  return `${file.section}:${file.path}`
}

const SECTION_ORDER: { key: GitFileSection; title: string }[] = [
  { key: 'staged', title: 'Staged Changes' },
  { key: 'unstaged', title: 'Changes' },
  { key: 'untracked', title: 'Untracked' },
]

const STATUS_COLORS: Record<GitFileEntry['status'], string> = {
  '?': theme.success,
  'A': theme.success,
  'C': theme.accent,
  'D': theme.danger,
  'M': theme.warning,
  'R': theme.accent,
  'U': theme.danger,
}

function displayStatus(file: GitFileEntry): string {
  if (file.section === 'untracked') return 'A'
  return file.status
}

function groupBySection(files: GitFileEntry[]): Record<GitFileSection, GitFileEntry[]> {
  const groups: Record<GitFileSection, GitFileEntry[]> = {
    staged: [],
    unstaged: [],
    untracked: [],
  }
  for (const file of files) groups[file.section].push(file)
  return groups
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

export function splitPath(path: string): { prefix: string; basename: string } {
  const slash = path.lastIndexOf('/')
  if (slash < 0) return { basename: path, prefix: '' }
  return { basename: path.slice(slash + 1), prefix: path.slice(0, slash + 1) }
}

function stripTrailingSlash(prefix: string): string {
  return prefix.endsWith('/') ? prefix.slice(0, -1) : prefix
}

function renderPath(file: GitFileEntry): ReactNode {
  const { basename, prefix } = splitPath(file.path)
  const dir = stripTrailingSlash(prefix)
  if (file.renamedFrom) {
    const renamed = splitPath(file.renamedFrom)
    const renamedDir = stripTrailingSlash(renamed.prefix)
    return (
      <text wrapMode="none">
        <span fg={theme.text}>{renamed.basename}</span>
        {renamedDir ? <span fg={theme.textMuted}> {renamedDir}</span> : null}
        <span fg={theme.textMuted}> → </span>
        <span fg={theme.text}>{basename}</span>
        {dir ? <span fg={theme.textMuted}> {dir}</span> : null}
      </text>
    )
  }
  return (
    <text wrapMode="none">
      <span fg={theme.text}>{basename}</span>
      {dir ? <span fg={theme.textMuted}> {dir}</span> : null}
    </text>
  )
}

function renderFileRow(
  file: GitFileEntry,
  key: string,
  addedW: number,
  removedW: number,
  isSelected: boolean
): ReactNode {
  const hasNumstat = file.added !== null || file.removed !== null
  const bg = isSelected ? theme.panelHighlight : undefined
  return (
    <box key={key} flexDirection="row" gap={1} paddingLeft={1} backgroundColor={bg}>
      <text fg={STATUS_COLORS[file.status]} bg={bg}>
        <strong>{displayStatus(file)}</strong>
      </text>
      <box flexGrow={1} overflow="hidden">
        {renderPath(file)}
      </box>
      {hasNumstat ? (
        <box flexDirection="row" flexShrink={0}>
          <text fg={theme.success} bg={bg}>{`+${padRight(file.added, addedW)}`}</text>
          <text fg={theme.dim} bg={bg}>
            {' '}
          </text>
          <text fg={theme.danger} bg={bg}>{`−${padRight(file.removed, removedW)}`}</text>
        </box>
      ) : (
        <text fg={theme.textMuted} bg={bg} flexShrink={0}>
          —
        </text>
      )}
    </box>
  )
}

function renderSection(
  section: GitFileSection,
  title: string,
  files: GitFileEntry[],
  addedW: number,
  removedW: number,
  selectedFileKey: string | null | undefined
): ReactNode {
  if (files.length === 0) return null
  return (
    <box key={section} flexDirection="column">
      <text fg={theme.accentAlt}>
        <strong>
          {title} ({files.length})
        </strong>
      </text>
      {files.map((file, i) =>
        renderFileRow(
          file,
          `${section}-${i}`,
          addedW,
          removedW,
          !!selectedFileKey && fileKey(file) === selectedFileKey
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
    return { label: 'No active session', labelColor: theme.textMuted }
  }
  if (gitPanel.error === 'not-a-repo') {
    return { label: 'Not a git repository', labelColor: theme.textMuted }
  }
  if (gitPanel.error === 'unknown') {
    return { label: 'Git error', labelColor: theme.danger }
  }
  if (gitPanel.files.length === 0) {
    return { label: 'Working tree clean', labelColor: theme.textMuted }
  }
  return null
}

export const GitPanel = memo(function GitPanel({
  gitPanel,
  projectPath,
  selectedFileKey,
}: GitPanelProps) {
  const groups = useMemo(() => groupBySection(gitPanel.files), [gitPanel.files])
  const { added: addedW, removed: removedW } = useMemo(
    () => maxDigitWidth(gitPanel.files),
    [gitPanel.files]
  )

  const statusNode = renderStatus(gitPanel, !!projectPath)

  const hasRemoteTracking = gitPanel.ahead > 0 || gitPanel.behind > 0

  return (
    <box flexDirection="column" flexGrow={1} gap={0}>
      {hasRemoteTracking ? (
        <text fg={theme.textMuted}>
          ↑{gitPanel.ahead} ↓{gitPanel.behind}
        </text>
      ) : null}
      {statusNode ?? (
        <scrollbox
          flexGrow={1}
          scrollY
          viewportCulling
          contentOptions={{ flexDirection: 'column', gap: 0 }}
        >
          {SECTION_ORDER.map((s) =>
            renderSection(s.key, s.title, groups[s.key], addedW, removedW, selectedFileKey)
          )}
        </scrollbox>
      )}
    </box>
  )
})

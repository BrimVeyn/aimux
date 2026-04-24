import { useTerminalDimensions } from '@opentui/react'
import { memo, useEffect, useRef } from 'react'

import type { DiffData, GitDiffView } from '../../../state/types'
import type { ThemeId } from '../../themes'

import { diffHash } from '../../../git/diff-hash'
import { fetchDiff } from '../../../git/git-diff'
import { useGitPanelPolling } from '../../../git/git-poller'
import { useAppStore } from '../../../state/app-store'
import { dispatchGlobal } from '../../../state/dispatch-ref'
import { getSelectedGitFile, gitFileKey } from '../../../state/git-tree'
import { setGitDiffScroller } from '../../git-view-controls'
import { useTheme } from '../../theme'
import { PierreDiff, type PierreDiffHandle } from './diff-renderer'
import { useDiffPrefetch } from './diff-renderer/use-diff-prefetch'
import { GitPanel } from './git-panel'

interface DiffStageProps {
  diff: DiffData | undefined
  diffKey: string | null
  loading: boolean
  diffRef: React.RefObject<PierreDiffHandle | null>
  themeId: ThemeId
  view: GitDiffView
}

function placeholderText(diff: DiffData): string | null {
  if (diff.status === 'binary') {
    const before = diff.binarySizeBefore ?? 0
    const after = diff.binarySizeAfter ?? 0
    return `(binary file — ${before} → ${after} bytes)`
  }
  if (diff.rawDiff.length === 0) {
    if (diff.status === 'new') return '(new file — no diff)'
    if (diff.status === 'deleted') return '(deleted — no diff)'
    return '(no changes)'
  }
  return null
}

const DiffStage = memo(function DiffStage({
  diff,
  diffKey,
  diffRef,
  loading,
  themeId,
  view,
}: DiffStageProps) {
  const t = useTheme()
  if (loading && !diff) {
    return (
      <box flexGrow={1} padding={1}>
        <text fg={t['text-weak']}>Loading diff…</text>
      </box>
    )
  }
  if (!diff) {
    return (
      <box flexGrow={1} padding={1}>
        <text fg={t['text-weak']}>Select a file.</text>
      </box>
    )
  }
  if (diff.errorMessage) {
    return (
      <box flexGrow={1} padding={1}>
        <text fg={t['icon-critical-base']}>{diff.errorMessage}</text>
      </box>
    )
  }

  const placeholder = placeholderText(diff)
  if (placeholder) {
    return (
      <box flexGrow={1} padding={1}>
        <text fg={t['text-weak']}>{placeholder}</text>
      </box>
    )
  }

  return (
    <box flexDirection="column" flexGrow={1} overflow="hidden">
      {diff.oldPath ? (
        <box paddingLeft={1} paddingRight={1}>
          <text fg={t['text-weak']}>
            renamed: {diff.oldPath} → {diff.path}
          </text>
        </box>
      ) : null}
      <PierreDiff
        cacheKey={diffKey ?? diff.path}
        ref={diffRef}
        diff={diff.rawDiff}
        path={diff.path}
        themeId={themeId}
        view={view}
      />
    </box>
  )
})

interface GitViewProps {
  themeId: ThemeId
}

export const GitView = memo(function GitView({ themeId }: GitViewProps) {
  const t = useTheme()
  const sidebarBg = t['background-base']
  const actionBg = t['surface-raised-base-hover']
  const dimensions = useTerminalDimensions()
  const gitPane = useAppStore((s) => s.gitPane)
  const gitPanel = useAppStore((s) => s.gitPanel)
  const gitMode = useAppStore((s) => s.gitMode)
  const currentSessionId = useAppStore((s) => s.currentSessionId)
  const sessions = useAppStore((s) => s.sessions)
  const focusMode = useAppStore((s) => s.focusMode)
  const diffRef = useRef<PierreDiffHandle | null>(null)

  const currentSession = currentSessionId
    ? sessions.find((s) => s.id === currentSessionId)
    : undefined
  const projectPath = currentSession?.projectPath

  useGitPanelPolling({ enabled: focusMode === 'git', headOffset: gitMode.headOffset, projectPath })

  const fileBarWidth = Math.max(20, Math.floor(dimensions.width * gitPane.diffModeRatio))

  const selectedFile = getSelectedGitFile(gitPanel.files, {
    collapsedFolders: gitMode.collapsedFolders,
    compact: gitPane.treeCompaction,
    fileListMode: gitPane.fileListMode,
    selectedEntryKey: gitMode.selectedEntryKey,
  })
  const selectedDiffKey = selectedFile ? gitFileKey(selectedFile) : null
  const diff = selectedDiffKey ? gitMode.diffs[selectedDiffKey] : undefined
  const loading = selectedDiffKey ? !!gitMode.loading[selectedDiffKey] : false

  useEffect(() => {
    setGitDiffScroller((delta: number) => {
      const node = diffRef.current
      if (!node) return
      const left = node.leftScroll
      const right = node.rightScroll
      if (!left) return
      const cap = Math.max(left.scrollHeight - left.viewport.height, 0)
      const base = left.scrollTop
      const nextScroll = Math.max(0, Math.min(cap, base + delta))
      left.scrollTop = nextScroll
      if (right && right !== left) right.scrollTop = nextScroll
    })
    return () => setGitDiffScroller(null)
  }, [])

  useDiffPrefetch(gitMode.selectedEntryKey, gitPane.prefetchRadius, {
    enabled: focusMode === 'git',
    headOffset: gitMode.headOffset,
    projectPath,
    themeId,
  })

  useEffect(() => {
    if (focusMode !== 'git') return
    if (!selectedFile || !projectPath) return
    if (!selectedDiffKey) return
    if (diff || loading) return
    dispatchGlobal({ key: selectedDiffKey, loading: true, type: 'git-mode-set-loading' })
    void fetchDiff(projectPath, selectedFile, gitMode.headOffset)
      .then((d) =>
        dispatchGlobal({
          diff: d,
          hash: diffHash(d.rawDiff),
          key: selectedDiffKey,
          type: 'git-mode-set-diff',
        })
      )
      .catch(() =>
        dispatchGlobal({ key: selectedDiffKey, loading: false, type: 'git-mode-set-loading' })
      )
  }, [focusMode, projectPath, selectedFile, selectedDiffKey, diff, loading, gitMode.headOffset])

  const pendingPath = gitMode.pendingDeletePath
  const pendingIsUntracked =
    pendingPath !== null &&
    selectedFile?.path === pendingPath &&
    selectedFile.section === 'untracked'
  let pendingHint: string | null = null
  if (pendingPath !== null && selectedFile) {
    pendingHint = pendingIsUntracked
      ? 'press d again to delete file'
      : 'press d again to discard changes'
  }
  const actionMessage = gitMode.actionMessage
  let footerNode: React.ReactNode = null
  if (pendingHint) {
    footerNode = (
      <text fg={t['icon-warning-base']}>
        <strong>{pendingHint}</strong>
      </text>
    )
  } else if (actionMessage) {
    footerNode = actionMessage.split('\n').map((line, idx) => (
      <text key={idx} fg={t['text-interactive-base']}>
        {line}
      </text>
    ))
  }

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="row" flexGrow={1}>
        <box
          width={fileBarWidth}
          flexDirection="column"
          backgroundColor={sidebarBg}
          padding={0}
          gap={0}
        >
          <text fg={t['icon-strong-base']}>
            <strong>aimux · git</strong>
          </text>
          {gitPanel.branch ? (
            <box flexDirection="row">
              <text fg={t['icon-base']}>{'\u{e702}'} </text>
              <text fg={t['text-base']}>{gitPanel.branch}</text>
            </box>
          ) : null}
          {gitMode.headOffset > 0 ? (
            <box flexDirection="row" gap={1}>
              <text fg={t['icon-warning-base']}>
                <strong>HEAD~{gitMode.headOffset}</strong>
              </text>
              <text fg={t['text-weak']}>[ newer · ] older</text>
            </box>
          ) : null}
          <text fg={t['text-weaker']}>{'·'.repeat(Math.max(0, fileBarWidth - 2))}</text>
          <GitPanel
            collapsedFolders={gitMode.collapsedFolders}
            compact={gitPane.treeCompaction}
            fileListMode={gitPane.fileListMode}
            gitPanel={gitPanel}
            headOffset={gitMode.headOffset}
            projectPath={projectPath}
            selectedEntryKey={gitMode.selectedEntryKey}
          />
        </box>
        <box flexDirection="column" flexGrow={1} overflow="hidden">
          <box
            flexDirection="row"
            alignItems="center"
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={sidebarBg}
          >
            <box flexGrow={1}>
              <text fg={selectedFile ? t['text-base'] : t['text-weak']}>
                {selectedFile ? selectedFile.path : 'Diff'}
              </text>
            </box>
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={actionBg}
              onMouseDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
                dispatchGlobal({ type: 'exit-git-mode' })
              }}
            >
              <text fg={t['text-base']}>
                <strong>Exit diff</strong>
              </text>
            </box>
          </box>
          <DiffStage
            diff={diff}
            diffKey={selectedDiffKey}
            diffRef={diffRef}
            loading={loading}
            themeId={themeId}
            view={gitMode.diffView}
          />
        </box>
      </box>
      {footerNode ? (
        <box paddingLeft={1} paddingRight={1} backgroundColor={sidebarBg} flexDirection="column">
          {footerNode}
        </box>
      ) : null}
    </box>
  )
})

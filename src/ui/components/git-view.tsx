import { memo, useEffect, useRef } from 'react'

import type { DiffData, GitDiffView } from '../../state/types'
import type { ThemeId } from '../themes'

import { fetchDiff } from '../../git/git-diff'
import { useGitPanelPolling } from '../../git/git-poller'
import { useAppStore } from '../../state/app-store'
import { dispatchGlobal } from '../../state/dispatch-ref'
import { setGitDiffScroller } from '../git-view-controls'
import { theme } from '../theme'
import { PierreDiff, type PierreDiffHandle } from './diff-renderer'
import { fileKey, GitPanel } from './git-panel'

interface DiffStageProps {
  diff: DiffData | undefined
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
  diffRef,
  loading,
  themeId,
  view,
}: DiffStageProps) {
  if (loading && !diff) {
    return (
      <box flexGrow={1} padding={1}>
        <text fg={theme.textMuted}>Loading diff…</text>
      </box>
    )
  }
  if (!diff) {
    return (
      <box flexGrow={1} padding={1}>
        <text fg={theme.textMuted}>Select a file.</text>
      </box>
    )
  }
  if (diff.errorMessage) {
    return (
      <box flexGrow={1} padding={1}>
        <text fg={theme.danger}>{diff.errorMessage}</text>
      </box>
    )
  }

  const placeholder = placeholderText(diff)
  if (placeholder) {
    return (
      <box flexGrow={1} padding={1}>
        <text fg={theme.textMuted}>{placeholder}</text>
      </box>
    )
  }

  return (
    <box flexDirection="column" flexGrow={1} overflow="hidden">
      {diff.oldPath ? (
        <box paddingLeft={1} paddingRight={1}>
          <text fg={theme.textMuted}>
            renamed: {diff.oldPath} → {diff.path}
          </text>
        </box>
      ) : null}
      <PierreDiff
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
  const sidebarWidth = useAppStore((s) => s.sidebar.width)
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

  useGitPanelPolling({ enabled: focusMode === 'git', projectPath })

  const selectedFile = gitPanel.files[gitMode.selectedFileIndex]
  const diff = selectedFile ? gitMode.diffs[selectedFile.path] : undefined
  const loading = selectedFile ? !!gitMode.loading[selectedFile.path] : false

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

  useEffect(() => {
    if (focusMode !== 'git') return
    if (!selectedFile || !projectPath) return
    const path = selectedFile.path
    if (diff || loading) return
    dispatchGlobal({ loading: true, path, type: 'git-mode-set-loading' })
    void fetchDiff(projectPath, selectedFile)
      .then((d) => dispatchGlobal({ diff: d, path, type: 'git-mode-set-diff' }))
      .catch(() => dispatchGlobal({ loading: false, path, type: 'git-mode-set-loading' }))
  }, [focusMode, projectPath, selectedFile, diff, loading])

  const pendingPath = gitMode.pendingDeletePath
  const pendingIsUntracked =
    pendingPath !== null &&
    selectedFile?.path === pendingPath &&
    selectedFile.section === 'untracked'
  let pendingHint: string | null = null
  if (pendingPath !== null) {
    pendingHint = pendingIsUntracked
      ? 'press d again to delete file'
      : 'press d again to discard changes'
  }
  const actionMessage = gitMode.actionMessage
  let footerNode: React.ReactNode = null
  if (pendingHint) {
    footerNode = (
      <text fg={theme.warning}>
        <strong>{pendingHint}</strong>
      </text>
    )
  } else if (actionMessage) {
    footerNode = actionMessage.split('\n').map((line, idx) => (
      <text key={idx} fg={theme.accent}>
        {line}
      </text>
    ))
  }

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="row" flexGrow={1}>
        <box
          width={sidebarWidth}
          flexDirection="column"
          backgroundColor={theme.panel}
          padding={0}
          gap={0}
        >
          <text fg={theme.accent}>
            <strong>aimux · git</strong>
          </text>
          {gitPanel.branch ? (
            <box flexDirection="row">
              <text fg={theme.accent}>{'\u{e702}'} </text>
              <text fg={theme.textMuted}>{gitPanel.branch}</text>
            </box>
          ) : null}
          <text fg={theme.dim}>{'·'.repeat(Math.max(0, sidebarWidth - 2))}</text>
          <GitPanel
            gitPanel={gitPanel}
            projectPath={projectPath}
            selectedFileKey={selectedFile ? fileKey(selectedFile) : null}
          />
        </box>
        <DiffStage
          diff={diff}
          diffRef={diffRef}
          loading={loading}
          themeId={themeId}
          view={gitMode.diffView}
        />
      </box>
      {footerNode ? (
        <box paddingLeft={1} paddingRight={1} backgroundColor={theme.panel} flexDirection="column">
          {footerNode}
        </box>
      ) : null}
    </box>
  )
})

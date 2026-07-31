import { memo, useCallback } from 'react'

import type { GitPanelState } from '../../../../state/types'

import { useAppStore } from '../../../../state/app-store'
import { dispatchGlobal, runSideEffectGlobal } from '../../../../state/dispatch-ref'
import { useTheme } from '../../../theme'

export type GitPaneTab = 'files' | 'checks'

interface GitPaneHeaderProps {
  gitPanel: GitPanelState
  projectPath: string | undefined
  headOffset?: number
  baseLabel?: string
  /** Only the bar widget switches tabs; full-screen git mode omits these. */
  tab?: GitPaneTab
  onTabChange?: (tab: GitPaneTab) => void
}

export const GitPaneHeader = memo(function GitPaneHeader({
  baseLabel,
  gitPanel,
  headOffset = 0,
  onTabChange,
  projectPath,
  tab,
}: GitPaneHeaderProps) {
  const t = useTheme()
  const fileListMode = useAppStore((s) => s.gitPane.fileListMode)
  const nextFileListMode = fileListMode === 'tree' ? 'flat' : 'tree'
  const toggleListMode = useCallback(() => {
    dispatchGlobal({ type: 'git-mode-toggle-file-list-mode' })
    runSideEffectGlobal({ mode: nextFileListMode, type: 'persist-git-file-list-mode' })
  }, [nextFileListMode])
  const showFiles = useCallback(() => onTabChange?.('files'), [onTabChange])
  const showChecks = useCallback(() => onTabChange?.('checks'), [onTabChange])

  const hasTabs = tab !== undefined && onTabChange !== undefined
  const hasProject = projectPath != null && projectPath !== ''
  if (!hasProject) return null
  // A git error must not hide the tab row, otherwise there's no way back to
  // `files` (and the PR checks are still worth showing outside a repo).
  if (gitPanel.error !== null && !hasTabs) return null

  const branch = gitPanel.branch
  const branchLabel = branch != null && branch !== '' ? branch : 'detached'
  const branchIsResolved = branch != null && branch !== ''

  const ahead = gitPanel.ahead
  const behind = gitPanel.behind
  const showAhead = ahead > 0
  const showBehind = behind > 0
  const showTracking = showAhead || showBehind

  // On the checks tab the PR summary already names the branch, and the
  // working-tree counters are irrelevant — drop the whole git row.
  const showGitRow = tab !== 'checks' && gitPanel.error === null
  const showToggle = showGitRow && gitPanel.files.length > 0
  const showHistorical = headOffset > 0
  const showReviewBase = baseLabel != null && baseLabel !== ''
  const showScope = showHistorical || showReviewBase

  return (
    <box flexDirection="column" flexShrink={0} paddingBottom={1}>
      {hasTabs ? (
        <box flexDirection="row" gap={1} onMouseDown={tab === 'files' ? showChecks : showFiles}>
          <text
            selectable={false}
            fg={tab === 'files' ? t.primary : t.textMuted}
            wrapMode="none"
            onMouseDown={showFiles}
          >
            files
          </text>
          <text selectable={false} fg={t.textMuted} wrapMode="none">
            |
          </text>
          <text
            selectable={false}
            fg={tab === 'checks' ? t.primary : t.textMuted}
            wrapMode="none"
            onMouseDown={showChecks}
          >
            checks
          </text>
        </box>
      ) : null}
      {showGitRow ? (
        <box flexDirection="row" justifyContent="space-between">
          <box flexDirection="row" flexShrink={1} overflow="hidden">
            <text selectable={false} fg={t.textMuted} wrapMode="none">
              {'\u{e702}'}
            </text>
            <text selectable={false} fg={t.textMuted} wrapMode="none">
              {' '}
            </text>
            <text selectable={false} fg={branchIsResolved ? t.text : t.textMuted} wrapMode="none">
              {branchIsResolved ? <strong>{branchLabel}</strong> : branchLabel}
            </text>
          </box>
          <box flexDirection="row" flexShrink={0} gap={2}>
            {showTracking ? (
              <box flexDirection="row" gap={1}>
                {showAhead ? (
                  <text selectable={false} fg={t.textMuted} wrapMode="none">
                    {`↑${ahead}`}
                  </text>
                ) : null}
                {showBehind ? (
                  <text selectable={false} fg={t.textMuted} wrapMode="none">
                    {`↓${behind}`}
                  </text>
                ) : null}
              </box>
            ) : null}
            {showToggle ? (
              <box flexDirection="row" gap={1} paddingLeft={1} onMouseDown={toggleListMode}>
                <text
                  selectable={false}
                  fg={fileListMode === 'tree' ? t.primary : t.textMuted}
                  wrapMode="none"
                >
                  tree
                </text>
                <text selectable={false} fg={t.textMuted} wrapMode="none">
                  |
                </text>
                <text
                  selectable={false}
                  fg={fileListMode === 'flat' ? t.primary : t.textMuted}
                  wrapMode="none"
                >
                  flat
                </text>
              </box>
            ) : null}
          </box>
        </box>
      ) : null}
      {showScope ? (
        <box flexDirection="row" gap={2}>
          {showHistorical ? (
            <text selectable={false} fg={t.warning} wrapMode="none">
              <strong>HEAD~{headOffset}</strong>
            </text>
          ) : null}
          {showHistorical ? (
            <text selectable={false} fg={t.textMuted} wrapMode="none">
              [ newer · ] older
            </text>
          ) : null}
          {showReviewBase ? (
            <text selectable={false} fg={t.primary} wrapMode="none">
              <strong>{baseLabel}</strong>
            </text>
          ) : null}
          {showReviewBase ? (
            <text selectable={false} fg={t.textMuted} wrapMode="none">
              b: back
            </text>
          ) : null}
        </box>
      ) : null}
    </box>
  )
})

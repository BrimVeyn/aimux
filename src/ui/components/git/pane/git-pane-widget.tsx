import { memo, useRef } from 'react'

import type { GitPanelState } from '../../../../state/types'

import { useGitPanelPolling } from '../../../../git/git-poller'
import { useRepoDiscovery } from '../../../../git/use-repo-discovery'
import { useAppStore } from '../../../../state/app-store'
import { getSessionProjectPath } from '../../../../state/session-worktrees'
import { GitPanel } from '../git-panel'
import { GitPaneHeader } from './git-pane-header'

interface GitPaneWidgetProps {
  pollingEnabled: boolean
}

export const GitPaneWidget = memo(function GitPaneWidget({ pollingEnabled }: GitPaneWidgetProps) {
  const gitPanel = useAppStore((s) => s.gitPanel)
  const gitMode = useAppStore((s) => s.gitMode)
  const gitFileListMode = useAppStore((s) => s.gitPane.fileListMode)
  const treeCompaction = useAppStore((s) => s.gitPane.treeCompaction)
  const pathConfig = useAppStore((s) => s.gitPane.path)
  const diffCountConfig = useAppStore((s) => s.gitPane.diffCount)
  const currentSessionId = useAppStore((s) => s.currentSessionId)
  const sessions = useAppStore((s) => s.sessions)
  const currentSession =
    currentSessionId != null && currentSessionId !== ''
      ? sessions.find((s) => s.id === currentSessionId)
      : undefined
  const projectPath = getSessionProjectPath(currentSession)

  useRepoDiscovery(projectPath)
  useGitPanelPolling({ enabled: pollingEnabled, headOffset: 0, projectPath })

  const lastGoodRef = useRef<GitPanelState | null>(null)
  const prevProjectPathRef = useRef(projectPath)
  if (prevProjectPathRef.current !== projectPath) {
    prevProjectPathRef.current = projectPath
    lastGoodRef.current = null
  }
  const isGood = gitPanel.error === null && gitPanel.branch !== null
  if (isGood) {
    lastGoodRef.current = gitPanel
  }
  const display = lastGoodRef.current ?? gitPanel

  return (
    <box flexDirection="column" flexGrow={1} flexShrink={1} flexBasis={0} overflow="hidden">
      <GitPaneHeader gitPanel={display} projectPath={projectPath} />
      <GitPanel
        collapsedFolders={gitMode.collapsedFolders}
        compact={treeCompaction}
        diffCountConfig={diffCountConfig}
        fileListMode={gitFileListMode}
        gitPanel={display}
        pathConfig={pathConfig}
        projectPath={projectPath}
        selectedEntryKey={gitMode.selectedEntryKey}
        showFileListToggle={false}
        showRemoteTracking={false}
      />
    </box>
  )
})

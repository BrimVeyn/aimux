import { memo, useRef, useState } from 'react'

import type { GitPanelState } from '../../../../state/types'

import { useGitPanelPolling } from '../../../../git/git-poller'
import { usePrStatusPolling } from '../../../../git/pr-status-poller'
import { useRepoDiscovery } from '../../../../git/use-repo-discovery'
import { useAppStore } from '../../../../state/app-store'
import { getActiveWorkspacePath } from '../../../../state/project-workspaces'
import { GitPanel } from '../git-panel'
import { GitPaneHeader, type GitPaneTab } from './git-pane-header'
import { PrChecksPanel } from './pr-checks-panel'

interface GitPaneWidgetProps {
  pollingEnabled: boolean
  contentWidth: number
}

export const GitPaneWidget = memo(function GitPaneWidget({
  contentWidth,
  pollingEnabled,
}: GitPaneWidgetProps) {
  const gitPanel = useAppStore((s) => s.gitPanel)
  const gitMode = useAppStore((s) => s.gitMode)
  const gitFileListMode = useAppStore((s) => s.gitPane.fileListMode)
  const treeCompaction = useAppStore((s) => s.gitPane.treeCompaction)
  const pathConfig = useAppStore((s) => s.gitPane.path)
  const diffCountConfig = useAppStore((s) => s.gitPane.diffCount)
  const currentProjectId = useAppStore((s) => s.currentProjectId)
  const projects = useAppStore((s) => s.projects)
  const currentProject =
    currentProjectId != null && currentProjectId !== ''
      ? projects.find((s) => s.id === currentProjectId)
      : undefined
  const projectPath = getActiveWorkspacePath(currentProject)

  const [tab, setTab] = useState<GitPaneTab>('files')

  useRepoDiscovery(projectPath)
  useGitPanelPolling({ enabled: pollingEnabled, headOffset: 0, projectPath })
  // The PR state row sits above the tabs, so this has to run on both of them.
  usePrStatusPolling({ enabled: pollingEnabled, projectPath })

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
      <GitPaneHeader gitPanel={display} onTabChange={setTab} projectPath={projectPath} tab={tab} />
      {tab === 'checks' ? (
        <PrChecksPanel contentWidth={contentWidth} />
      ) : (
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
      )}
    </box>
  )
})

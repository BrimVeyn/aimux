import { memo, useRef } from 'react'

import type { GitPanelState } from '../../state/types'

import { useGitPanelPolling } from '../../git/git-poller'
import { useAppStore } from '../../state/app-store'
import { GitPanel } from './git-panel'

interface GitPaneWidgetProps {
  pollingEnabled: boolean
}

export const GitPaneWidget = memo(function GitPaneWidget({ pollingEnabled }: GitPaneWidgetProps) {
  const gitPanel = useAppStore((s) => s.gitPanel)
  const pathConfig = useAppStore((s) => s.gitPane.path)
  const diffCountConfig = useAppStore((s) => s.gitPane.diffCount)
  const currentSessionId = useAppStore((s) => s.currentSessionId)
  const sessions = useAppStore((s) => s.sessions)
  const currentSession = currentSessionId
    ? sessions.find((s) => s.id === currentSessionId)
    : undefined
  const projectPath = currentSession?.projectPath

  useGitPanelPolling({ enabled: pollingEnabled, projectPath })

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
    <GitPanel
      diffCountConfig={diffCountConfig}
      gitPanel={display}
      pathConfig={pathConfig}
      projectPath={projectPath}
    />
  )
})

import type { TabSession } from '../state/types'
import type { SideEffectContext } from './side-effect-context'

import { copyToSystemClipboard } from '../platform/clipboard'
import { getActiveWorkspace } from '../state/project-workspaces'
import { toast } from '../state/toast-store'
import { currentGitHunk } from '../ui/git-view-controls'
import { writePasteToTab } from './pty-write'

function isLiveAgent(tab: TabSession): boolean {
  return tab.assistant !== 'terminal' && tab.status === 'running'
}

/**
 * The agent a hunk goes to: the tab git mode was opened over when it is one,
 * else the first agent of the workspace on screen.
 */
function reviewTarget(ctx: SideEffectContext): TabSession | undefined {
  const { state } = ctx
  const active = state.tabs.find((tab) => tab.id === state.activeTabId)
  if (active && isLiveAgent(active)) return active
  const project = state.projects.find((entry) => entry.id === state.currentProjectId)
  const workspaceId = getActiveWorkspace(project)?.id
  return state.tabs.find(
    (tab) => isLiveAgent(tab) && (workspaceId === undefined || tab.workspaceId === workspaceId)
  )
}

/**
 * Copies the change block at the top of the diff, or pastes it into the agent's
 * prompt without sending it, so several can be gathered into one message.
 */
export function copyGitHunk(ctx: SideEffectContext, to: 'agent' | 'clipboard'): void {
  const text = currentGitHunk()
  if (text === null) {
    toast.info('No change here to copy')
    return
  }
  if (to === 'clipboard') {
    copyToSystemClipboard(text)
    toast.success('Change copied')
    return
  }
  const tab = reviewTarget(ctx)
  if (!tab) {
    toast.error('No running agent in this workspace')
    return
  }
  writePasteToTab(ctx.backend, tab.id, tab, `${text}\n`)
  toast.success(`Change added to ${tab.title}'s prompt`)
}

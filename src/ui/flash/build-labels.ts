import type { AppState, FlashJumpTarget, FlashLabel } from '../../state/types'

import { filterTabsForActiveWorktree } from '../../state/project-worktrees'
import { orderProjectsForDisplay } from '../project-ordering'
import { assignFlashLabels, type FlashTarget } from './assign-labels'

interface PendingTarget {
  key: string
  name: string
  target: FlashJumpTarget
}

/**
 * Collect every visible flash-jump target in the same order the UI renders:
 * workspace rows first (each followed by its non-primary worktrees), then the
 * tabs of the active worktree. Stable ordering keeps the assigned labels
 * predictable across re-opens when nothing changed.
 */
function collectTargets(state: AppState): PendingTarget[] {
  const out: PendingTarget[] = []
  const ordered = orderProjectsForDisplay(state.projects)
  for (const [index, project] of ordered.entries()) {
    const projectIndex = index + 1
    const worktrees = project.worktrees ?? []
    const primary = worktrees.find((w) => w.source === 'primary') ?? worktrees[0]
    out.push({
      key: `ws:${project.id}`,
      name: project.name,
      target: {
        kind: 'workspace',
        projectId: project.id,
        projectIndex,
        worktreeId: primary?.id,
      },
    })
    for (const worktree of worktrees) {
      if (worktree.id === primary?.id) continue
      out.push({
        key: `wt:${worktree.id}`,
        name: worktree.name,
        target: {
          kind: 'worktree',
          projectId: project.id,
          projectIndex,
          worktreeId: worktree.id,
        },
      })
    }
  }

  const currentProject = state.projects.find((s) => s.id === state.currentProjectId)
  if (currentProject) {
    const tabs = filterTabsForActiveWorktree(state.tabs, currentProject)
    for (const tab of tabs) {
      out.push({
        key: `tab:${tab.id}`,
        name: tab.title,
        target: { kind: 'tab', projectId: currentProject.id, projectIndex: 0, tabId: tab.id },
      })
    }
  }

  return out
}

export function buildFlashJumpLabels(state: AppState): FlashLabel[] {
  const pending = collectTargets(state)
  const flashTargets: FlashTarget[] = pending.map(({ key, name }) => ({ key, name }))
  const assigned = assignFlashLabels(flashTargets)
  const byKey = new Map(pending.map((entry) => [entry.key, entry.target]))
  const out: FlashLabel[] = []
  for (const { key, label } of assigned) {
    const target = byKey.get(key)
    if (!target) continue
    out.push({ key, label, target })
  }
  return out
}

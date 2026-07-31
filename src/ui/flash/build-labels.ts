import type { AppState, FlashJumpTarget, FlashLabel } from '../../state/types'

import { filterTabsForActiveWorkspace } from '../../state/project-workspaces'
import { orderProjectsForDisplay } from '../project-ordering'
import { assignFlashLabels, type FlashTarget } from './assign-labels'

interface PendingTarget {
  key: string
  name: string
  target: FlashJumpTarget
}

/**
 * Collect every visible flash-jump target in the same order the UI renders:
 * project rows first (each followed by its non-primary workspaces), then the
 * tabs of the active workspace. Stable ordering keeps the assigned labels
 * predictable across re-opens when nothing changed.
 */
function collectTargets(state: AppState): PendingTarget[] {
  const out: PendingTarget[] = []
  const ordered = orderProjectsForDisplay(state.projects)
  for (const [index, project] of ordered.entries()) {
    const projectIndex = index + 1
    const workspaces = project.workspaces ?? []
    const primary = workspaces.find((w) => w.source === 'primary') ?? workspaces[0]
    out.push({
      key: `ws:${project.id}`,
      name: project.name,
      target: {
        kind: 'project',
        projectId: project.id,
        projectIndex,
        workspaceId: primary?.id,
      },
    })
    for (const workspace of workspaces) {
      if (workspace.id === primary?.id) continue
      out.push({
        key: `wt:${workspace.id}`,
        name: workspace.name,
        target: {
          kind: 'workspace',
          projectId: project.id,
          projectIndex,
          workspaceId: workspace.id,
        },
      })
    }
  }

  const currentProject = state.projects.find((s) => s.id === state.currentProjectId)
  if (currentProject) {
    const tabs = filterTabsForActiveWorkspace(state.tabs, currentProject)
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

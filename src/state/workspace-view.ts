import type { BranchDivergence, ProjectRecord, WorkspaceSource } from './types'

/** The little of a workspace these helpers actually read. */
interface WorkspaceShape {
  id: string
  source?: WorkspaceSource
}

// Pure view helpers for the sidebar's workspace rows. They live apart from
// `project-workspaces.ts` because that module reaches for node:child_process /
// fs / path, and the GUI renderer — which draws the same rows in a browser —
// has to be able to import these without dragging node into the bundle.

/** `4823` -> `4.8k`, so a churn number never widens the sidebar row. */
export function formatDiffCount(value: number): string {
  if (value < 1_000) return String(value)
  const thousands = value / 1_000
  if (thousands < 10) return `${thousands.toFixed(1).replace(/\.0$/, '')}k`
  return `${Math.round(thousands)}k`
}

/** `+149 -629` — lines the workspace changed since it forked. Empty when clean. */
export function formatDiffStat(divergence: BranchDivergence | undefined): {
  added: string
  removed: string
} {
  const added = divergence?.added ?? 0
  const removed = divergence?.removed ?? 0
  return {
    added: added > 0 ? `+${formatDiffCount(added)}` : '',
    removed: removed > 0 ? `-${formatDiffCount(removed)}` : '',
  }
}

/**
 * The workspace rows a folded project still shows: just the one the cursor is
 * on, so folding never hides the row you are standing on — and, for a project
 * you are not in, nothing at all.
 *
 * Sidebar navigation calls this with `isCurrent: true` for every project: the
 * moment j/k crosses into one it *is* current, and a project whose rows all
 * vanished from the item list would be unreachable by keyboard.
 */
// Generic over the workspace and project shapes: the GUI renderer draws these
// same rows from its wire-level projections, and a second copy of the folding
// rule would drift from this one.
export function getSidebarWorkspaces<W extends WorkspaceShape>(
  project: { workspaces?: W[]; activeWorkspaceId?: string; collapsed?: boolean },
  isCurrent: boolean
): W[] {
  const workspaces = project.workspaces ?? []
  if (project.collapsed !== true) return workspaces
  if (!isCurrent) return []
  const active = getActiveWorkspace(project)
  return active ? [active] : []
}

/**
 * The workspace standing for the repo checkout itself.
 *
 * Falls back to the first record because a project loaded from an older
 * catalog can have workspaces with no `primary` among them, and every caller
 * wants *something* to anchor the project row on. Callers that need the real
 * primary or nothing — the CLI, catalog repair — should keep asking for
 * `source === 'primary'` directly and get `undefined` when it is absent.
 */
export function getPrimaryWorkspace<W extends WorkspaceShape>(
  workspaces: W[] | undefined
): W | undefined {
  if (!workspaces) return undefined
  return workspaces.find((workspace) => workspace.source === 'primary') ?? workspaces[0]
}

/** The workspace a project's cursor sits on: its active one, else the checkout. */
export function getActiveWorkspace<W extends WorkspaceShape>(
  project: { workspaces?: W[]; activeWorkspaceId?: string } | undefined
): W | undefined {
  return (
    project?.workspaces?.find((workspace) => workspace.id === project.activeWorkspaceId) ??
    getPrimaryWorkspace(project?.workspaces)
  )
}

/**
 * The cwd to work in: the active workspace's path, falling back to the project
 * root. Not the same as `project.projectPath`, which names the repo itself.
 */
export function getActiveWorkspacePath(project: ProjectRecord | undefined): string | undefined {
  return getActiveWorkspace(project)?.path ?? project?.projectPath
}

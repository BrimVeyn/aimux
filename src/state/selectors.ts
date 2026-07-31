import type { AssistantOption } from '../pty/command-registry'
import type { ProjectRecord, SnippetRecord, WorkspaceRecord } from './types'

export interface BaseRefOption {
  /** Git ref the new workspace is forked from. */
  ref: string
  label: string
  kind: 'workspace' | 'branch'
  /** Workspace name, for the 'workspace' kind. */
  detail?: string
}

/**
 * Ordered, filtered base-ref candidates for the workspace-create "Base" picker:
 * branches checked out in the project's workspaces first (labelled with the
 * workspace name), then the remaining local branches. A branch already surfaced
 * via a workspace is not repeated. Throwaway `aimux/` branches are skipped unless
 * a live workspace is on them — `git worktree remove` leaves the branch behind,
 * so deleted temp workspaces would otherwise haunt the list as orphan branches.
 */
export function buildBaseRefOptions(
  workspaces: WorkspaceRecord[],
  localBranches: string[],
  query: string
): BaseRefOption[] {
  const seen = new Set<string>()
  const options: BaseRefOption[] = []
  for (const workspace of workspaces) {
    if (workspace.branch == null || workspace.branch === '' || seen.has(workspace.branch)) continue
    seen.add(workspace.branch)
    options.push({
      detail: workspace.name,
      kind: 'workspace',
      label: workspace.branch,
      ref: workspace.branch,
    })
  }
  for (const branch of localBranches) {
    if (seen.has(branch) || branch.startsWith('aimux/')) continue
    seen.add(branch)
    options.push({ kind: 'branch', label: branch, ref: branch })
  }
  const trimmed = query.trim().toLowerCase()
  if (trimmed === '') return options
  return options.filter((option) => option.label.toLowerCase().includes(trimmed))
}

export function filterAssistants(
  options: AssistantOption[],
  filter: string | null
): AssistantOption[] {
  if (!(filter != null && filter !== '')) return options
  const lower = filter.toLowerCase()
  return options.filter(
    (o) => o.label.toLowerCase().includes(lower) || o.description.toLowerCase().includes(lower)
  )
}

export function filterProjects(projects: ProjectRecord[], filter: string | null): ProjectRecord[] {
  if (!(filter != null && filter !== '')) {
    return projects
  }

  const lower = filter.toLowerCase()
  return projects.filter(
    (project) =>
      project.name.toLowerCase().includes(lower) ||
      (project.projectPath != null &&
        project.projectPath !== '' &&
        project.projectPath.toLowerCase().includes(lower))
  )
}

export function filterSnippets(snippets: SnippetRecord[], filter: string | null): SnippetRecord[] {
  if (!(filter != null && filter !== '')) {
    return snippets
  }

  const lower = filter.toLowerCase()
  return snippets.filter(
    (snippet) =>
      snippet.name.toLowerCase().includes(lower) || snippet.content.toLowerCase().includes(lower)
  )
}

import type { AssistantOption } from '../pty/command-registry'
import type { AssistantId, SessionRecord, SnippetRecord, WorktreeRecord } from './types'

export interface BaseRefOption {
  /** Git ref the new worktree is forked from. */
  ref: string
  label: string
  kind: 'worktree' | 'branch'
  /** Worktree name, for the 'worktree' kind. */
  detail?: string
}

/**
 * Ordered, filtered base-ref candidates for the worktree-create "Base" picker:
 * branches checked out in the session's worktrees first (labelled with the
 * worktree name), then the remaining local branches. A branch already surfaced
 * via a worktree is not repeated. Throwaway `aimux/` branches are skipped unless
 * a live worktree is on them — `git worktree remove` leaves the branch behind,
 * so deleted temp worktrees would otherwise haunt the list as orphan branches.
 */
export function buildBaseRefOptions(
  worktrees: WorktreeRecord[],
  localBranches: string[],
  query: string
): BaseRefOption[] {
  const seen = new Set<string>()
  const options: BaseRefOption[] = []
  for (const worktree of worktrees) {
    if (worktree.branch == null || worktree.branch === '' || seen.has(worktree.branch)) continue
    seen.add(worktree.branch)
    options.push({
      detail: worktree.name,
      kind: 'worktree',
      label: worktree.branch,
      ref: worktree.branch,
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

/**
 * 0 when the template picker should NOT show the "None" fallback (no assistant
 * was picked — typical for the template shortcut path), 1 otherwise. Shared
 * by the modal reducer, the side-effect that resolves templateId, and the
 * picker UI so the three stay in sync.
 */
export function getTemplateNoneOffset(selectedAssistantId: AssistantId | null): 0 | 1 {
  return selectedAssistantId == null ? 0 : 1
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

export function filterSessions(sessions: SessionRecord[], filter: string | null): SessionRecord[] {
  if (!(filter != null && filter !== '')) {
    return sessions
  }

  const lower = filter.toLowerCase()
  return sessions.filter(
    (session) =>
      session.name.toLowerCase().includes(lower) ||
      (session.projectPath != null &&
        session.projectPath !== '' &&
        session.projectPath.toLowerCase().includes(lower))
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

// Names a workspace after the prompt that created it.
//
// Two stages, because a model call takes seconds and workspace creation must
// not wait on the network: a local heuristic name is applied at creation, then
// the generated one replaces it in place when it arrives. The heuristic result
// is not a stopgap to be embarrassed about — when no headless CLI is installed
// it is the final name, and it is still derived from what the user asked for.
//
// The branch is not a slug of that name. A tab title belongs to the user and
// speaks their language; a branch name is read by git, by reviewers and by CI,
// so the model is asked for it separately, in English and under a
// conventional-commit type. A branch is only renamed when the model returns one
// in that shape — the placeholder is a better outcome than a bad convention.

import type { AssistantId, WorkspaceRecord } from '../state/types'

import { heuristicTitle } from '../auto-rename/heuristic-title'
import { generateWorkspaceNaming, type TitleSpawnFn } from '../auto-rename/title-runner'
import { renameGitBranch } from '../git/worktree'

/** Model naming is best-effort background work; it must never outlive the app. */
const NAMING_TIMEOUT_MS = 30_000

/**
 * The name a workspace carries until the model answers. Undefined when the
 * prompt yields nothing usable, which lets `createAimuxTempWorkspace` fall back
 * to its own `wt-<project>` default.
 */
export function placeholderWorkspaceName(prompt: string): string | undefined {
  return heuristicTitle(prompt) ?? undefined
}

export interface WorkspaceNamingTarget {
  projectId: string
  workspace: WorkspaceRecord
  prompt: string
  /** Provider used for the naming call — the assistant the user just picked. */
  provider: AssistantId
}

export interface WorkspaceNamingDeps {
  applyName: (projectId: string, workspaceId: string, patch: Partial<WorkspaceRecord>) => void
  renameBranch?: (repoRoot: string, from: string, to: string) => Promise<boolean>
  spawn?: TitleSpawnFn
  signal?: AbortSignal
}

/**
 * Replace a workspace's placeholder name and branch with ones generated from
 * the prompt. Silent on every failure: a missing CLI, a timeout or a branch
 * collision all leave the placeholder standing, which is a perfectly usable
 * outcome and not worth a toast.
 *
 * ponytail: fixed timeout, no model override. Read `autoRename.models` here if
 * anyone wants naming on a cheaper model than the tab's assistant.
 */
export async function renameWorkspaceFromPrompt(
  target: WorkspaceNamingTarget,
  deps: WorkspaceNamingDeps
): Promise<void> {
  const result = await generateWorkspaceNaming({
    firstPrompt: target.prompt,
    provider: target.provider,
    signal: deps.signal ?? new AbortController().signal,
    spawn: deps.spawn,
    timeoutMs: NAMING_TIMEOUT_MS,
  })
  if (result.status !== 'ok') return

  const { workspace } = target
  const { branch } = result
  const rename = deps.renameBranch ?? renameGitBranch
  // Renamed from inside the workspace, not the main checkout: the branch is
  // that worktree's current branch, which is the form git always accepts.
  // Renaming first means a refusal (the name is taken) leaves the record
  // pointing at the branch that actually exists.
  const renamedBranch =
    branch != null &&
    workspace.branch != null &&
    workspace.branch !== '' &&
    branch !== workspace.branch &&
    (await rename(workspace.path, workspace.branch, branch))
      ? branch
      : undefined

  if (result.title === workspace.name && renamedBranch == null) return
  deps.applyName(target.projectId, workspace.id, {
    name: result.title,
    ...(renamedBranch == null ? null : { branch: renamedBranch }),
  })
}

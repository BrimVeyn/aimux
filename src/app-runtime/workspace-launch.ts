import type { AssistantId, PendingWorkspaceLaunch, WorkspaceRecord } from '../state/types'
import type { SideEffectContext } from './side-effect-context'

import { enqueueGitOp } from '../git/command-queue'
import { createPrefixedId } from '../platform/id'
import { hasSetupScript } from '../state/project-data'
import { findWorkspace } from '../state/project-workspaces'
import { toast } from '../state/toast-store'
import { findSetupTab } from './setup-actions'
import { launchWithPrompt } from './tab-actions'
import { createAimuxTempWorkspace } from './workspace-actions'
import { placeholderWorkspaceName, renameWorkspaceFromPrompt } from './workspace-naming'

/**
 * The `<C-p>` worktree being cut while its assistant picker is already open.
 * A barrier, not a value: what the launch needs to know — did the worktree
 * land — is read back from the store, which is the only thing that can still
 * be true a tick later.
 *
 * Single-slot: only one create-workspace modal can be open, so only one chain
 * can ever be in flight.
 */
let pendingWorkspaceCreate: Promise<void> | null = null

/**
 * The `<C-p>` flow: chain into the new-tab modal *now* and cut the worktree in
 * the background. `git fetch` + `worktree add` take seconds, and the next
 * question — which assistant — does not depend on either, so making the user
 * watch a frozen modal buys nothing. `launchPendingWorkspace` waits this out,
 * so the tab still lands in a finished workspace.
 */
export function startWorkspaceCreation(
  ctx: SideEffectContext,
  projectId: string,
  params: {
    prompt: string
    baseRef?: string
  }
): void {
  // Allocated here rather than by the create: the picker below pins its tab to
  // this workspace before git has produced anything to pin to.
  const workspaceId = createPrefixedId('workspace')
  pendingWorkspaceCreate = (async () => {
    try {
      await enqueueGitOp(async () =>
        // A name derived locally from the prompt, so the sidebar reads right from
        // the first frame. The model-generated one replaces it a few seconds later.
        // The branch is left to `createAimuxTempWorkspace`, which suffixes it with
        // a timestamp: two workspaces started from the same prompt must not
        // collide on the branch name before the model has distinguished them.
        createAimuxTempWorkspace(ctx, projectId, {
          baseRef: params.baseRef,
          name: placeholderWorkspaceName(params.prompt),
          workspaceId,
        })
      )
    } catch (error) {
      // The modal that would have shown this inline is already gone, so the
      // toast is the only channel left. The launch reads the missing record.
      toast.error(error instanceof Error ? error.message : String(error))
    }
  })()
  ctx.dispatch({ type: 'close-modal' })
  ctx.dispatch({
    pendingWorkspace: { projectId, prompt: params.prompt, workspaceId },
    type: 'open-new-tab-modal',
  })
}

/**
 * Setup runs concurrently with the agent by design, so say so rather than
 * letting the agent run tests against a half-installed tree and draw the wrong
 * conclusion. Only prefixed when a setup is actually live.
 */
function buildWorkspacePrompt(ctx: SideEffectContext, pending: PendingWorkspaceLaunch): string {
  const setupTab = findSetupTab(ctx.getState().tabs, pending.workspaceId)
  // No setup tab yet does not mean no setup: the workspace can land in the
  // store the same tick the user picks, and the runner only spawns on the next
  // render. A project with a script is about to run it, so say so.
  const setupRunning = setupTab ? setupTab.status === 'running' : hasSetupScript(pending.projectId)
  if (!setupRunning) return pending.prompt
  return `Note: a setup script is currently installing this workspace's dependencies in the background. Wait for it to finish before running builds, tests, or anything that reads installed dependencies.\n\n${pending.prompt}`
}

/**
 * Name the workspace after what its prompt describes, using the assistant the
 * user just picked. Background work that must never block or fail the launch.
 *
 * Always `pending.prompt`, never the setup-annotated variant built for the
 * agent — the note is guidance, not part of what the user asked for.
 */
function renameWorkspaceFromLaunch(
  ctx: SideEffectContext,
  pending: PendingWorkspaceLaunch,
  workspace: WorkspaceRecord,
  assistant: AssistantId
): void {
  void renameWorkspaceFromPrompt(
    { projectId: pending.projectId, prompt: pending.prompt, provider: assistant, workspace },
    {
      applyName: (projectId, workspaceId, patch) =>
        ctx.dispatch({ patch, projectId, type: 'update-workspace-record', workspaceId }),
    }
  )
}

/**
 * Pin the tab to the workspace `<C-p>` is cutting, hand it the prompt, and name
 * the workspace after what it describes.
 *
 * Waits for the worktree first: spawning early would drop the tab in the
 * project checkout instead, since that is what an unresolvable workspace id
 * falls back to.
 */
export function launchPendingWorkspace(
  ctx: SideEffectContext,
  assistant: AssistantId,
  pending: PendingWorkspaceLaunch
): void {
  const creating = pendingWorkspaceCreate
  pendingWorkspaceCreate = null
  void (async () => {
    await creating
    // Read the store again: the record landed after `ctx.state` was captured,
    // and its absence is how a failed create says "do not spawn".
    const fresh = { ...ctx, state: ctx.getState() }
    const found = findWorkspace(fresh.state.projects, pending.workspaceId)
    if (!found) {
      toast.error('Workspace creation failed — no tab was opened')
      return
    }
    launchWithPrompt(fresh, assistant, buildWorkspacePrompt(fresh, pending), pending.workspaceId)
    renameWorkspaceFromLaunch(fresh, pending, found.workspace, assistant)
  })()
}

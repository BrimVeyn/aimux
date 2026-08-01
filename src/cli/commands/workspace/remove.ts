import type { CliCommand } from '../../registry'

import { removeGitWorktree } from '../../../git/worktree'
import {
  IPC_CAPABILITY_LIST_TABS,
  IPC_CAPABILITY_WORKSPACE_LIFECYCLE_EVENTS,
} from '../../../ipc/protocol'
import { pruneEmptyWorktreeParent } from '../../../platform/worktree-paths'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'

export const workspaceRemove: CliCommand = {
  args: [{ complete: { kind: 'dynamic', source: 'workspace' }, name: 'workspace', required: true }],
  flags: [
    ...SHARED_FLAGS,
    { description: 'pass --force to git worktree remove', kind: 'boolean', name: 'force' },
  ],
  group: 'workspace',
  run: async (ctx) => {
    const target = ctx.args.positionals[0]
    if (typeof target !== 'string' || target.length === 0) {
      throw new Error('workspace id or path is required')
    }
    const force = ctx.args.flags.force === true

    const project = ctx.getProject()
    const workspace =
      project.workspaces?.find((w) => w.id === target) ??
      project.workspaces?.find((w) => w.path === target)
    if (!workspace) {
      const known = project.workspaces?.map((w) => w.id).join(', ') ?? '(none)'
      throw new Error(`unknown workspace: ${target} (known: ${known})`)
    }
    if (workspace.source === 'primary') {
      throw new Error('refusing to remove the primary workspace')
    }

    const primary = project.workspaces?.find((w) => w.source === 'primary')
    if (!primary) {
      throw new Error('project has no primary workspace — cannot resolve repoRoot for git remove')
    }

    const daemon = await ctx.getDaemon()
    if (!daemon.hasCapability(IPC_CAPABILITY_WORKSPACE_LIFECYCLE_EVENTS)) {
      throw new Error(
        'daemon predates workspaceLifecycleEvents capability — restart aimux to pick up the new daemon'
      )
    }
    if (daemon.hasCapability(IPC_CAPABILITY_LIST_TABS)) {
      const live = (await daemon.listTabs(project.id)).tabs.filter(
        (tab) => tab.workspaceId === workspace.id
      )
      if (live.length > 0) {
        throw new Error(
          `refusing to remove workspace with live tabs: ${live.map((tab) => tab.id).join(', ')}`
        )
      }
    }

    // All capability and liveness checks happen before touching git. If git
    // refuses a dirty workspace the catalog remains unchanged.
    await removeGitWorktree({ force, repoPath: primary.repoRoot, targetPath: workspace.path })
    await pruneEmptyWorktreeParent(workspace.path)
    try {
      await daemon.expectOk('removeWorkspaceRecord', {
        projectId: project.id,
        workspaceId: workspace.id,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(
        `worktree removed from git but catalog reconciliation failed for ${workspace.id}: ${message}`
      )
    }

    writeJson({ id: workspace.id, name: workspace.name, path: workspace.path })
    return EXIT_OK
  },
  summary: 'Remove a workspace from the active project',
  verb: 'remove',
}

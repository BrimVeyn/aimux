import type { CliCommand } from '../../registry'

import { removeGitWorktree } from '../../../git/worktree'
import {
  IPC_CAPABILITY_LIST_TABS,
  IPC_CAPABILITY_WORKTREE_LIFECYCLE_EVENTS,
} from '../../../ipc/protocol'
import { pruneEmptyWorktreeParent } from '../../../platform/worktree-paths'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'

export const worktreeRemove: CliCommand = {
  args: [{ complete: { kind: 'dynamic', source: 'worktree' }, name: 'worktree', required: true }],
  flags: [
    ...SHARED_FLAGS,
    { description: 'pass --force to git worktree remove', kind: 'boolean', name: 'force' },
  ],
  group: 'worktree',
  run: async (ctx) => {
    const target = ctx.args.positionals[0]
    if (typeof target !== 'string' || target.length === 0) {
      throw new Error('worktree id or path is required')
    }
    const force = ctx.args.flags.force === true

    const workspace = ctx.getWorkspace()
    const worktree =
      workspace.worktrees?.find((w) => w.id === target) ??
      workspace.worktrees?.find((w) => w.path === target)
    if (!worktree) {
      const known = workspace.worktrees?.map((w) => w.id).join(', ') ?? '(none)'
      throw new Error(`unknown worktree: ${target} (known: ${known})`)
    }
    if (worktree.source === 'primary') {
      throw new Error('refusing to remove the primary worktree')
    }

    const primary = workspace.worktrees?.find((w) => w.source === 'primary')
    if (!primary) {
      throw new Error('workspace has no primary worktree — cannot resolve repoRoot for git remove')
    }

    const daemon = await ctx.getDaemon()
    if (!daemon.hasCapability(IPC_CAPABILITY_WORKTREE_LIFECYCLE_EVENTS)) {
      throw new Error(
        'daemon predates worktreeLifecycleEvents capability — restart aimux to pick up the new daemon'
      )
    }
    if (daemon.hasCapability(IPC_CAPABILITY_LIST_TABS)) {
      const live = (await daemon.listTabs(workspace.id)).tabs.filter(
        (tab) => tab.worktreeId === worktree.id
      )
      if (live.length > 0) {
        throw new Error(
          `refusing to remove worktree with live tabs: ${live.map((tab) => tab.id).join(', ')}`
        )
      }
    }

    // All capability and liveness checks happen before touching git. If git
    // refuses a dirty worktree the catalog remains unchanged.
    await removeGitWorktree({ force, repoPath: primary.repoRoot, targetPath: worktree.path })
    await pruneEmptyWorktreeParent(worktree.path)
    try {
      await daemon.expectOk('removeWorktreeRecord', {
        projectId: workspace.id,
        worktreeId: worktree.id,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(
        `worktree removed from git but catalog reconciliation failed for ${worktree.id}: ${message}`
      )
    }

    writeJson({ id: worktree.id, name: worktree.name, path: worktree.path })
    return EXIT_OK
  },
  summary: 'Remove a worktree from the active workspace',
  verb: 'remove',
}

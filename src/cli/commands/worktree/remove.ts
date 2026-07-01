import type { CliCommand } from '../../registry'

import { removeGitWorktree } from '../../../git/worktree'
import { IPC_CAPABILITY_WORKTREE_LIFECYCLE_EVENTS } from '../../../ipc/protocol'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'

export const worktreeRemove: CliCommand = {
  args: [{ name: 'worktree', required: true }],
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

    // Git side first — matches the UI's discipline in side-effects.ts. If
    // git refuses (dirty, uncommitted changes) the catalog stays intact.
    await removeGitWorktree({ force, repoPath: primary.repoRoot, targetPath: worktree.path })

    const daemon = await ctx.getDaemon()
    if (!daemon.hasCapability(IPC_CAPABILITY_WORKTREE_LIFECYCLE_EVENTS)) {
      throw new Error(
        'daemon predates worktreeLifecycleEvents capability — restart aimux to pick up the new daemon'
      )
    }
    await daemon.expectOk('removeWorktreeRecord', {
      sessionId: workspace.id,
      worktreeId: worktree.id,
    })

    writeJson({ id: worktree.id, name: worktree.name, path: worktree.path })
    return EXIT_OK
  },
  summary: 'Remove a worktree from the active workspace',
  verb: 'remove',
}

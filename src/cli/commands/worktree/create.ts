import type { WorktreeRecord } from '../../../state/types'
import type { CliCommand } from '../../registry'

import { createGitWorktree } from '../../../git/worktree'
import { IPC_CAPABILITY_WORKTREE_LIFECYCLE_EVENTS } from '../../../ipc/protocol'
import { createPrefixedId } from '../../../platform/id'
import {
  assertSafeAimuxWorktreePath,
  ensureAimuxWorktreeRoot,
  makeWorktreePath,
} from '../../../platform/worktree-paths'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'

export const worktreeCreate: CliCommand = {
  args: [],
  flags: [
    ...SHARED_FLAGS,
    { description: 'display name for the new worktree', kind: 'string', name: 'name' },
    { description: 'branch name (defaults to aimux/<name>)', kind: 'string', name: 'branch' },
    { description: 'base ref for the branch (defaults to HEAD)', kind: 'string', name: 'base' },
  ],
  group: 'worktree',
  run: async (ctx) => {
    const name = ctx.args.flags.name
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('--name is required')
    }
    const branch =
      typeof ctx.args.flags.branch === 'string' ? ctx.args.flags.branch : `aimux/${name}`
    const base = typeof ctx.args.flags.base === 'string' ? ctx.args.flags.base : 'HEAD'

    const workspace = ctx.getWorkspace()
    const primary = workspace.worktrees?.find((w) => w.source === 'primary')
    if (!primary) {
      throw new Error(
        `workspace "${workspace.name}" has no primary worktree — set --project when creating it`
      )
    }

    const worktreeId = createPrefixedId('worktree')
    const targetPath = makeWorktreePath({
      repoRoot: primary.repoRoot,
      worktreeId,
      worktreeName: name,
    })
    await ensureAimuxWorktreeRoot()
    await assertSafeAimuxWorktreePath(targetPath)

    await createGitWorktree({
      baseRef: base,
      branchName: branch,
      repoPath: primary.repoRoot,
      targetPath,
    })

    const now = new Date().toISOString()
    const record: WorktreeRecord = {
      baseRef: base,
      branch,
      createdAt: now,
      createdByAimux: true,
      id: worktreeId,
      name,
      path: targetPath,
      repoRoot: primary.repoRoot,
      source: 'aimux-temp',
      updatedAt: now,
    }

    const daemon = await ctx.getDaemon()
    if (!daemon.hasCapability(IPC_CAPABILITY_WORKTREE_LIFECYCLE_EVENTS)) {
      throw new Error(
        'daemon predates worktreeLifecycleEvents capability — restart aimux to pick up the new daemon'
      )
    }
    await daemon.expectOk('addWorktreeRecord', { sessionId: workspace.id, worktree: record })

    writeJson({
      branch,
      id: worktreeId,
      name,
      path: targetPath,
      repoRoot: primary.repoRoot,
    })
    return EXIT_OK
  },
  summary: 'Create a new worktree in the active workspace',
  verb: 'create',
}

import type { CliCommand } from '../../registry'

import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'
import { createWorkspaceWorktree } from './create-core'

export const worktreeCreate: CliCommand = {
  args: [],
  flags: [
    ...SHARED_FLAGS,
    {
      complete: { kind: 'none' },
      description: 'display name for the new worktree',
      kind: 'string',
      name: 'name',
    },
    {
      complete: { kind: 'none' },
      description: 'branch name (defaults to aimux/<name>)',
      kind: 'string',
      name: 'branch',
    },
    {
      complete: { kind: 'dynamic', source: 'git-ref' },
      description: 'base ref for the branch (defaults to HEAD)',
      kind: 'string',
      name: 'base',
    },
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
    const daemon = await ctx.getDaemon()
    const record = await createWorkspaceWorktree({ base, branch, daemon, name, workspace })

    writeJson({
      branch: record.branch,
      id: record.id,
      name: record.name,
      path: record.path,
      repoRoot: record.repoRoot,
    })
    return EXIT_OK
  },
  summary: 'Create a new worktree in the active workspace',
  verb: 'create',
}

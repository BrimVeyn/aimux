import type { CliCommand } from '../../registry'

import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'
import { createProjectWorkspace } from './create-core'

export const workspaceCreate: CliCommand = {
  args: [],
  flags: [
    ...SHARED_FLAGS,
    {
      complete: { kind: 'none' },
      description: 'display name for the new workspace',
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
  group: 'workspace',
  run: async (ctx) => {
    const name = ctx.args.flags.name
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('--name is required')
    }
    const branch =
      typeof ctx.args.flags.branch === 'string' ? ctx.args.flags.branch : `aimux/${name}`
    const base = typeof ctx.args.flags.base === 'string' ? ctx.args.flags.base : 'HEAD'

    const project = ctx.getProject()
    const daemon = await ctx.getDaemon()
    const record = await createProjectWorkspace({ base, branch, daemon, name, project })

    writeJson({
      branch: record.branch,
      id: record.id,
      name: record.name,
      path: record.path,
      repoRoot: record.repoRoot,
    })
    return EXIT_OK
  },
  summary: 'Create a new workspace in the active project',
  verb: 'create',
}

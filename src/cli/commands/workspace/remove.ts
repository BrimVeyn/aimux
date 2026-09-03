import type { CliCommand } from '../../registry'

import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'
import { daemonWorkspaceRegistrar, removeProjectWorkspace } from './create-core'

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
    const workspace = await removeProjectWorkspace({
      daemon: daemonWorkspaceRegistrar(await ctx.getDaemon()),
      force: ctx.args.flags.force === true,
      project: ctx.getProject(),
      target,
    })
    writeJson({ id: workspace.id, name: workspace.name, path: workspace.path })
    return EXIT_OK
  },
  summary: 'Remove a workspace from the active project',
  verb: 'remove',
}

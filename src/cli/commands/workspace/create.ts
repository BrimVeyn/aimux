import { resolve as resolvePath } from 'node:path'

import type { CliCommand } from '../../registry'

import { IPC_CAPABILITY_WORKSPACE_LIFECYCLE } from '../../../ipc/protocol'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'

export const workspaceCreate: CliCommand = {
  args: [{ name: 'name', required: true }],
  flags: [
    ...SHARED_FLAGS,
    {
      description: 'project path to associate with the workspace',
      kind: 'string',
      name: 'project',
    },
    {
      description: 'immediately switch the running UI to the new workspace',
      kind: 'boolean',
      name: 'switch',
    },
  ],
  group: 'workspace',
  run: async (ctx) => {
    const name = ctx.args.positionals[0]
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('workspace name is required')
    }
    const projectRaw =
      typeof ctx.args.flags.project === 'string' ? ctx.args.flags.project : undefined
    const projectPath = projectRaw === undefined ? undefined : resolvePath(projectRaw)
    const doSwitch = ctx.args.flags.switch === true

    const daemon = await ctx.getDaemon()
    if (!daemon.hasCapability(IPC_CAPABILITY_WORKSPACE_LIFECYCLE)) {
      throw new Error(
        'daemon predates workspaceLifecycle capability — restart aimux to pick up the new daemon'
      )
    }

    await daemon.expectOk('createWorkspace', { name, projectPath, switch: doSwitch })
    writeJson({ name, projectPath, switch: doSwitch })
    return EXIT_OK
  },
  summary: 'Create a new workspace (via the UI when attached, otherwise the catalog)',
  verb: 'create',
}

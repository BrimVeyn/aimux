import { resolve as resolvePath } from 'node:path'

import type { CliCommand } from '../../registry'

import { IPC_CAPABILITY_WORKSPACE_LIFECYCLE } from '../../../ipc/protocol'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, EXIT_TIMEOUT, writeJson } from '../../output'

const DEFAULT_WAIT_TIMEOUT_MS = 30_000

export const workspaceCreate: CliCommand = {
  args: [{ complete: { kind: 'none' }, name: 'name', required: true }],
  flags: [
    ...SHARED_FLAGS,
    {
      complete: { kind: 'file' },
      description: 'project path to associate with the workspace',
      kind: 'string',
      name: 'project',
    },
    {
      description: 'immediately switch the running UI to the new workspace',
      kind: 'boolean',
      name: 'switch',
    },
    {
      description: 'with --switch, wait until the UI confirms the switch completed',
      kind: 'boolean',
      name: 'wait',
    },
    {
      description: 'timeout for --wait, in milliseconds (default 30000)',
      kind: 'number',
      name: 'timeout',
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
    const wait = ctx.args.flags.wait === true
    const timeoutMs =
      typeof ctx.args.flags.timeout === 'number' ? ctx.args.flags.timeout : DEFAULT_WAIT_TIMEOUT_MS

    if (wait && !doSwitch) {
      // Without --switch, the UI never emits an ack event, so there's
      // nothing meaningful for --wait to wait on.
      throw new Error('--wait requires --switch (nothing to wait for otherwise)')
    }

    const daemon = await ctx.getDaemon()
    if (!daemon.hasCapability(IPC_CAPABILITY_WORKSPACE_LIFECYCLE)) {
      throw new Error(
        'daemon predates workspaceLifecycle capability — restart aimux to pick up the new daemon'
      )
    }

    if (!wait) {
      await daemon.expectOk('createWorkspace', { name, projectPath, switch: doSwitch })
      writeJson({ name, projectPath, switch: doSwitch })
      return EXIT_OK
    }

    // Subscribe BEFORE sending the request. The UI's create+switch path
    // relays as `workspaceSwitched` once handleCreateProjectEffect has
    // dispatched load-project. Match on name+projectPath since the CLI
    // doesn't know the id the UI will assign to the new project.
    const settled = new Promise<number>((resolve) => {
      const off = daemon.on('workspaceSwitched', (payload) => {
        off()
        clearTimeout(timer)
        writeJson({ name, projectId: payload.projectId, projectPath, switch: doSwitch })
        resolve(EXIT_OK)
      })
      const timer = setTimeout(() => {
        off()
        writeJson({ error: 'timed out waiting for workspaceSwitched', name, projectPath })
        resolve(EXIT_TIMEOUT)
      }, timeoutMs)
    })

    await daemon.expectOk('createWorkspace', { name, projectPath, switch: doSwitch })
    return settled
  },
  summary: 'Create a new workspace (via the UI when attached, otherwise the catalog)',
  verb: 'create',
}

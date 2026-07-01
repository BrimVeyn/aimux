import type { CliCommand } from '../../registry'

import { IPC_CAPABILITY_WORKSPACE_LIFECYCLE } from '../../../ipc/protocol'
import { resolveWorkspace } from '../../client/workspace-resolver'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'

export const workspaceClose: CliCommand = {
  args: [{ name: 'workspace', required: true }],
  flags: [
    ...SHARED_FLAGS,
    { description: 'force close even when tabs are pinned', kind: 'boolean', name: 'force' },
  ],
  group: 'workspace',
  run: async (ctx) => {
    const target = ctx.args.positionals[0]
    if (typeof target !== 'string' || target.length === 0) {
      throw new Error('target workspace is required (id or name)')
    }
    const session = resolveWorkspace(target)
    const force = ctx.args.flags.force === true

    const daemon = await ctx.getDaemon()
    if (!daemon.hasCapability(IPC_CAPABILITY_WORKSPACE_LIFECYCLE)) {
      throw new Error(
        'daemon predates workspaceLifecycle capability — restart aimux to pick up the new daemon'
      )
    }

    await daemon.expectOk('closeWorkspace', { force, targetSessionId: session.id })
    writeJson({ closedSessionId: session.id, force, name: session.name })
    return EXIT_OK
  },
  summary: 'Close a workspace (via the UI when attached, otherwise the catalog)',
  verb: 'close',
}

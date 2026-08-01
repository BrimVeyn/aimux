import type { CliCommand } from '../../registry'

import { IPC_CAPABILITY_THIN_ATTACH } from '../../../ipc/protocol'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'

export const tabFocus: CliCommand = {
  args: [{ complete: { kind: 'dynamic', source: 'tab' }, name: 'tabId', required: true }],
  flags: SHARED_FLAGS,
  group: 'tab',
  run: async (ctx) => {
    const tabId = ctx.args.positionals[0]
    if (typeof tabId !== 'string' || tabId.length === 0) {
      throw new Error('tabId is required')
    }

    const project = ctx.getProject()
    const daemon = await ctx.getDaemon()

    if (!daemon.hasCapability(IPC_CAPABILITY_THIN_ATTACH)) {
      throw new Error(
        'daemon predates thinAttach capability — restart aimux to pick up the new daemon'
      )
    }
    await daemon.attach({ cols: 0, projectId: project.id, rows: 0, thin: true })
    await daemon.expectOk('setActiveTab', { tabId })

    writeJson({ ok: true })
    return EXIT_OK
  },
  summary: 'Set the active tab in the project',
  verb: 'focus',
}

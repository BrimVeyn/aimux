import type { TabActivity } from '../../../state/types'
import type { CliCommand } from '../../registry'

import { IPC_CAPABILITY_THIN_ATTACH } from '../../../ipc/protocol'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, EXIT_TIMEOUT, writeNdjson } from '../../output'

const DEFAULT_TIMEOUT_MS = 30_000

function isTabActivity(value: string): value is TabActivity {
  return value === 'idle' || value === 'working' || value === 'waiting-input'
}

export const tabWait: CliCommand = {
  args: [{ name: 'tabId', required: true }],
  flags: [
    ...SHARED_FLAGS,
    {
      description: 'target activity (idle | working | waiting-input)',
      kind: 'string',
      name: 'status',
    },
    { description: 'timeout in milliseconds (default 30000)', kind: 'number', name: 'timeout' },
  ],
  group: 'tab',
  run: async (ctx) => {
    const tabId = ctx.args.positionals[0]
    if (typeof tabId !== 'string' || tabId.length === 0) {
      throw new Error('tabId is required')
    }
    const statusFlag = ctx.args.flags.status
    if (typeof statusFlag !== 'string' || !isTabActivity(statusFlag)) {
      throw new Error('--status must be one of: idle, working, waiting-input')
    }
    const timeoutMs =
      typeof ctx.args.flags.timeout === 'number' ? ctx.args.flags.timeout : DEFAULT_TIMEOUT_MS

    const workspace = ctx.getWorkspace()
    const daemon = await ctx.getDaemon()
    if (!daemon.hasCapability(IPC_CAPABILITY_THIN_ATTACH)) {
      throw new Error(
        'daemon predates thinAttach capability — restart aimux to pick up the new daemon'
      )
    }

    await daemon.attach({ cols: 0, rows: 0, sessionId: workspace.id, thin: true })

    return new Promise<number>((resolve) => {
      const start = Date.now()
      const off = daemon.on('tabStatus', (payload) => {
        if (payload.tabId !== tabId) return
        writeNdjson({ status: payload.status, tabId, ts: Date.now() - start })
        if (payload.status === statusFlag) {
          off()
          clearTimeout(timer)
          resolve(EXIT_OK)
        }
      })
      const timer = setTimeout(() => {
        off()
        writeNdjson({ status: 'timeout', tabId, ts: Date.now() - start })
        resolve(EXIT_TIMEOUT)
      }, timeoutMs)
    })
  },
  summary: 'Stream tabStatus events until the tab reaches the requested state',
  verb: 'wait',
}

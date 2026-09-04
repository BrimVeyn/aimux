import { type DaemonPluginContext, definePlugin } from '@brimveyn/aimux-plugin'

import type { TabUsage } from './usage'

/**
 * Reads the transcript, which is a file — so it happens here, and it happens
 * when a turn ends rather than on a timer: `tab:turnComplete` is the moment
 * the number changes, and between turns it does not.
 *
 * `ctx.assistants.session` and `usage` answer from what the daemon already
 * keeps: the session id is parsed out of the tab's argv, the transcript found
 * on disk under it. A tab spawned by any client answers the same way.
 */
export default definePlugin({
  apply(context) {
    const ctx = context as DaemonPluginContext

    const read = async (tabId: string): Promise<TabUsage | null> => {
      const session = ctx.assistants.session(tabId)
      if (!session) return null
      const usage = await ctx.assistants.usage(tabId)
      if (!usage) return null
      return { session, usage }
    }

    ctx.rpc.handle('usage', async (payload) => read((payload as { tabId: string }).tabId))

    ctx.rpc.handle('resume', async (payload) => {
      const { tabId } = payload as { tabId: string }
      const session = ctx.assistants.session(tabId)
      if (!session || session.sessionId === null) {
        return { reason: 'this tab has no session to resume', resumed: false }
      }
      const newTabId = await ctx.assistants.resume(tabId)
      ctx.log.info('resumed', { from: tabId, sessionId: session.sessionId, to: newTabId })
      return { resumed: true, tabId: newTabId }
    })

    ctx.on<{ tabId: string }>('tab:turnComplete', async ({ tabId }) => {
      const usage = await read(tabId)
      // One-way: every attached UI redraws its tile, and there is no answer.
      if (usage !== null) ctx.rpc.broadcast('usage', usage)
    })
  },
})

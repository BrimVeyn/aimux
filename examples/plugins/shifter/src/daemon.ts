import { type DaemonPluginContext, definePlugin } from '@brimveyn/aimux-plugin'

import { commandFor, gearAt } from './gears'

/**
 * The half that can actually type. `ctx.tabs.send` is a daemon service,
 * because the daemon owns the PTYs — so the UI half asks, and this answers.
 *
 * It is one RPC handler and nothing else, which is the usual shape: the UI
 * half decides *when*, the daemon half is what makes it possible.
 */
export default definePlugin({
  apply(context) {
    const ctx = context as DaemonPluginContext

    ctx.rpc.handle('engage', async (payload) => {
      const { gear, tabId } = payload as { gear: number; tabId: string }
      const command = commandFor(ctx.config, gear)
      if (command === null) {
        return { engaged: false, reason: `gear ${gear} has no command configured` }
      }

      const tab = ctx.tabs.get(tabId)
      if (!tab) {
        return { engaged: false, reason: `no tab ${tabId}` }
      }

      // A newline of its own: `send` writes bytes, not lines, and the
      // assistant is waiting for the return key like any other input.
      await ctx.tabs.send(tabId, `${command}\r`)
      ctx.log.info('engaged a gear', { command, gear, tabId })
      return { engaged: true, label: gearAt(gear).label }
    })
  },
})

import { type DaemonPluginContext, definePlugin } from '@brimveyn/aimux-plugin'

/**
 * Reading a file belongs on this side, even a small one. The UI process is
 * drawing frames; a synchronous read on its render path is a stutter, and one
 * on a timer is a stutter you get every time.
 *
 * `ctx.metrics.counters` is aimux's own record of its use — counts, per local
 * day, and nothing else: no key identity, no content, nothing that leaves the
 * machine.
 */
export default definePlugin({
  apply(context) {
    const ctx = context as DaemonPluginContext
    const days = typeof ctx.config.days === 'number' ? ctx.config.days : 14

    ctx.rpc.handle('counters', () => ctx.metrics.counters(Math.max(1, days)))
  },
})

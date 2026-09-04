import {
  definePlugin,
  type PluginNotificationEvent,
  type UiPluginContext,
} from '@brimveyn/aimux-plugin'

/**
 * The half that holds the slot. `ctx.ui.notifications.provide` hands every
 * notification aimux would have made — its own two, and any plugin's — to the
 * sink, and while the sink holds the slot the native sound does not play.
 *
 * The sink only decides what to say. Delivering is a subprocess or an HTTP
 * call, and neither belongs in the process that is drawing frames, so it is
 * one RPC to the daemon half.
 */

interface Delivered {
  delivered: string[]
  reason?: string
}

export default definePlugin({
  apply(context) {
    const ctx = context as UiPluginContext

    const describe = (event: PluginNotificationEvent): { title: string; message: string } => {
      const tab =
        event.tabId === undefined
          ? undefined
          : ctx.ui.state.get().tabs.find((candidate) => candidate.id === event.tabId)
      const where = tab === undefined ? '' : ` — ${tab.title}`
      return { message: event.message ?? '', title: `${event.title}${where}` }
    }

    ctx.ui.notifications.provide(async (event) => {
      const { message, title } = describe(event)
      try {
        const result = await ctx.rpc.call<Delivered>('deliver', {
          kind: event.kind,
          level: event.level ?? 'info',
          message,
          title,
        })
        if (result.delivered.length === 0) {
          // Nothing configured, or everything refused: the user still gets
          // told, in the app — silence is the one outcome a sink must not
          // produce, having taken the sound away.
          ctx.ui.toast.info(result.reason === undefined ? title : `${title} (${result.reason})`)
        }
      } catch (error) {
        ctx.ui.toast.error(`ntfy: ${error instanceof Error ? error.message : String(error)}`)
      }
    })

    // Through `notify`, not straight to the daemon: a test that skips the sink
    // would test the wrong thing.
    ctx.actions.effect('test', () => {
      ctx.ui.notifications.notify({
        level: 'info',
        message: 'If you can read this away from the keyboard, it works.',
        title: 'aimux test',
      })
    })
    ctx.actions.register(
      'test',
      () => ({
        actions: [],
        effects: [{ effectId: 'test', pluginId: ctx.id, type: 'plugin-effect' }],
      }),
      {
        description: 'Raise one notification through whatever is configured',
        title: 'Test notification',
      }
    )
  },
})

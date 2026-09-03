import { definePlugin, type UiPluginContext } from '@brimveyn/aimux-plugin'

/**
 * A shifter in miniature: a widget, an action, and a manifest that asks for a
 * place and a key. Deliberately shaped like the example plugin an agent is
 * asked to reproduce — the point of the loop test is that nothing else has to
 * happen for it to be visible and reachable.
 */
export default definePlugin({
  apply(context) {
    const ctx = context as UiPluginContext
    let gear = 1

    ctx.ui.widgets.register({
      id: 'gear',
      label: 'Gear',
      render: () => null,
    })

    ctx.actions.register('up', () => ({
      actions: [],
      effects: [{ effectId: 'engage', payload: gear + 1, pluginId: ctx.id, type: 'plugin-effect' }],
    }))

    ctx.actions.effect('engage', (payload) => {
      gear = typeof payload === 'number' ? payload : gear
    })

    ctx.rpc.handle('gear', () => gear)
  },
})

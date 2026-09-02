import { definePlugin, type UiPluginContext } from '@brimveyn/aimux-plugin'

interface Slice {
  count: number
}

/** Fixture exercising every service on the UI context. */
export default definePlugin<UiPluginContext<Slice>>({
  apply(ctx) {
    ctx.ui.widgets.register({ id: 'board', label: 'Board', render: () => null })
    ctx.ui.views.register({ id: 'board', render: () => null, title: 'Board' })
    ctx.ui.modals.register({ id: 'confirm', render: () => null, title: 'Confirm' })

    ctx.store.reducer((slice, action) => ({
      count: (slice?.count ?? 0) + (action.actionId === 'inc' ? 1 : 0),
    }))

    ctx.actions.register('open', () => ({
      actions: [],
      effects: [{ effectId: 'greet', pluginId: ctx.id, type: 'plugin-effect' }],
    }))
    ctx.actions.effect('greet', () => {
      ctx.store.dispatch('inc')
    })
  },
})

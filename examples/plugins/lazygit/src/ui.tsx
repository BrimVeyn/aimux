import { definePlugin, type UiPluginContext } from '@brimveyn/aimux-plugin'

/**
 * The pane is declared in the manifest — `panes[]` is `registerCommand`
 * without the TypeScript — so this file exists for one reason: a key. A
 * declared pane can be opened by code, and a key runs code, and that is the
 * whole of what is here.
 *
 * Toggle rather than open: a command pane has a process, so "is it open" is a
 * question with a cost behind it, and `openCommandPanes` is how a plugin asks.
 */
export default definePlugin({
  apply(context) {
    const ctx = context as UiPluginContext
    const direction = ctx.config.direction === 'horizontal' ? 'horizontal' : 'vertical'

    ctx.actions.effect('toggle', () => {
      if (ctx.ui.panes.openCommandPanes().includes('git')) {
        ctx.ui.panes.close('git')
        return
      }
      ctx.ui.panes.open('git', direction)
    })

    ctx.actions.register(
      'toggle',
      () => ({
        actions: [],
        effects: [{ effectId: 'toggle', pluginId: ctx.id, type: 'plugin-effect' }],
      }),
      {
        description: 'Open lazygit beside the agent, or close it — program included',
        title: 'Toggle lazygit',
      }
    )
  },
})

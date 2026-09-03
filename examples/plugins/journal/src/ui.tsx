import { definePlugin, type UiPluginContext } from '@brimveyn/aimux-plugin'
import { join } from 'node:path'

/**
 * The pane, registered from code rather than from the manifest for one
 * reason: its argv contains a path only this half knows — `ctx.paths.state`,
 * which is where the service writes. A manifest cannot expand an environment
 * variable, and should not learn to.
 *
 * `cwd: 'plugin'` so `src/tail.ts` resolves wherever the plugin is linked or
 * installed.
 */
export default definePlugin({
  apply(context) {
    const ctx = context as UiPluginContext
    const journal = join(ctx.paths.state, 'journal.ndjson')

    ctx.ui.panes.registerCommand({
      command: ['bun', 'src/tail.ts', journal],
      cwd: 'plugin',
      id: 'log',
      title: 'Journal',
    })

    ctx.actions.effect('toggle', () => {
      if (ctx.ui.panes.openCommandPanes().includes('log')) {
        ctx.ui.panes.close('log')
        return
      }
      ctx.ui.panes.open('log', 'horizontal')
    })
    ctx.actions.register(
      'toggle',
      () => ({
        actions: [],
        effects: [{ effectId: 'toggle', pluginId: ctx.id, type: 'plugin-effect' }],
      }),
      { description: 'Show or hide the event journal under the agent', title: 'Toggle journal' }
    )
  },
})

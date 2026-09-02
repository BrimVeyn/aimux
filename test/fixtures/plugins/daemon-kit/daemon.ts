import { type DaemonPluginContext, definePlugin } from '@brimveyn/aimux-plugin'

/** Fixture exercising every service on the daemon context. */
export default definePlugin<DaemonPluginContext>({
  apply(ctx) {
    ctx.assistants.register({
      detectStatus: ({ haystack }: { haystack: string }) =>
        haystack.includes('whirring') ? 'working' : null,
      option: {
        command: 'acme-robot',
        description: 'Acme robot CLI',
        id: 'acme.robot',
        label: 'Acme robot',
      },
    })

    ctx.hooks.route('events', (event) => {
      ctx.log.info('hook', { event: JSON.stringify(event) })
    })

    ctx.cli.register({
      group: 'acme',
      run: async (args) => ({ echoed: args.positionals }),
      summary: 'Ping the robot',
      verb: 'ping',
    })

    ctx.rpc.handle('tabCount', () => ctx.tabs.list().length)
    ctx.rpc.handle('spawnWorker', async () =>
      ctx.tabs.spawn({
        assistant: 'acme.robot',
        command: 'acme-robot',
        projectId: 'p1',
        title: 'Robot',
      })
    )
    ctx.rpc.handle('nudge', async (tabId) => {
      await ctx.tabs.send(String(tabId), 'hello\r')
    })
    ctx.on('tab:turnComplete', (payload) => {
      ctx.log.info('turn complete', { payload: JSON.stringify(payload) })
    })
  },
})

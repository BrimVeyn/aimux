import { definePlugin } from '@brimveyn/aimux-plugin'

/**
 * Fixture. Records what it was given on a module-level array so a test can
 * assert the plugin actually ran, and registers one of every reversible thing
 * so disposal has something to prove.
 */
export const applied: string[] = []

export default definePlugin({
  apply(ctx) {
    applied.push(`daemon:${String(ctx.config.greeting)}`)
    ctx.log.info('hello from the daemon half')

    ctx.on('test:ping', () => 'pong-from-daemon')
    ctx.rpc.handle('greet', (payload) => `${String(ctx.config.greeting)} ${String(payload)}`)
    ctx.effect(() => {
      const timer = setInterval(() => {}, 60_000)
      return () => clearInterval(timer)
    })
  },
})

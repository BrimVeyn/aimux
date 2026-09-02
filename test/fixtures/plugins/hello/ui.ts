import { definePlugin } from '@brimveyn/aimux-plugin'

export default definePlugin({
  apply(ctx) {
    ctx.log.info('hello from the ui half')
    ctx.on('test:ping', () => 'pong-from-ui')
  },
})

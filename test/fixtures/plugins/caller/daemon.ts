import { definePlugin } from '@brimveyn/aimux-plugin'

/** Fixture: forwards to the other half, exercising the daemon → UI direction
 *  where the protocol has no server-initiated request. */
export default definePlugin({
  apply(ctx) {
    ctx.rpc.handle('ask', async (payload) => ctx.rpc.call('question', payload))
  },
})

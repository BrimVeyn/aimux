import { definePlugin } from '@brimveyn/aimux-plugin'

/** Fixture: stays PENDING until `tabs` is provided, then applies. */
export default definePlugin({
  apply(ctx) {
    ctx.rpc.handle('tabsPresent', () => ctx.service('tabs') !== undefined)
  },
  inject: ['tabs'],
})

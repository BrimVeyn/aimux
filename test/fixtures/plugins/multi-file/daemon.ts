import { definePlugin } from '@brimveyn/aimux-plugin'

import { VALUE } from './value.ts'

/** Fixture proving a reload picks up a change in a *transitive* dependency —
 *  the exact case the `?v=` cache-buster approach could not handle. */
export default definePlugin({
  apply(ctx) {
    ctx.rpc.handle('value', () => VALUE)
  },
})

import { definePlugin } from '@brimveyn/aimux-plugin'

/** Fixture: throws in `apply` after registering, so the fiber must land in
 *  FAILED with nothing left registered. */
export default definePlugin({
  apply(ctx) {
    ctx.on('test:ping', () => 'never')
    throw new Error('deliberate fixture failure')
  },
})

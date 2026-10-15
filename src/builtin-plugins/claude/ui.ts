import { definePlugin, type UiPluginContext } from '@brimveyn/aimux-plugin'

import { ensureClaudeSettingsHooks } from './hooks-install'

/**
 * What aimux writes into Claude Code's own configuration.
 *
 * This was a `useEffect` in `app.tsx`, which was the wrong place: it is not
 * about rendering, and it is not something everyone wants. As a plugin it has
 * one switch, the same `enabled: false` line that turns off anything else.
 *
 * The toggle did not move. It already had a settings row, and a migration that
 * relocated a user's configuration would be a migration that broke it — so the
 * plugin reads aimux's row through `ctx.ui.settings` rather than declaring
 * config of its own.
 */

/** The settings row this plugin obeys. Id as written in `aimux.config.ts`. */
const CLAUDE_HOOKS_ROW = 'integrations.claudeHooks'

export default definePlugin({
  apply(context) {
    const ctx = context as UiPluginContext

    ctx.ui.settings.watch(CLAUDE_HOOKS_ROW, (value) => {
      // Idempotent, and one-way: turning the row off leaves what was written
      // in place, which is what the row's "needs a restart" marker has always
      // meant. Turning it on now takes effect without one.
      if (value === true) ensureClaudeSettingsHooks()
    })

    ctx.log.info('claude integration active')
  },
})

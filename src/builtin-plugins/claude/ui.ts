import type { ResolvedTuiTheme, ThemeMode } from '@brimveyn/aimux-config'

import { definePlugin, type UiPluginContext } from '@brimveyn/aimux-plugin'

import { ensureClaudeSettingsHooks } from './hooks-install'
import { ensureClaudeSettingsThemePref, syncClaudeTheme } from './theme-sync'

/**
 * What aimux writes into Claude Code's own configuration.
 *
 * Both halves of it were `useEffect`s in `app.tsx`, which is the wrong place
 * for two reasons that only became visible once there was somewhere better:
 * neither is about rendering, and neither is something everyone wants. As a
 * plugin they are one unit with one switch, and the switch is the same
 * `enabled: false` line that turns off anything else.
 *
 * The toggles did not move. Both features already had a settings row, and a
 * migration that relocated a user's configuration would be a migration that
 * broke it — so the plugin reads aimux's rows through `ctx.ui.settings` rather
 * than declaring config of its own.
 */

/** The settings rows this plugin obeys. Ids as written in `aimux.config.ts`. */
const HARMONIZE_THEME_ROW = 'theme.beta.harmonizeClaudeTheme'
const CLAUDE_HOOKS_ROW = 'integrations.claudeHooks'

export default definePlugin({
  apply(context) {
    const ctx = context as UiPluginContext
    const { settings, themes } = ctx.ui

    /**
     * Write the palette out, if the user asked for that. Checked at call time
     * rather than at subscribe time so there is one subscription for the life
     * of the plugin instead of one per toggle.
     */
    const pushTheme = (): void => {
      if (settings.get(HARMONIZE_THEME_ROW) !== true) return
      const snapshot = themes.current()
      ensureClaudeSettingsThemePref()
      // The plugin-facing snapshot is deliberately flat — a third-party plugin
      // wants colour tokens, not aimux's theme type. This one happens to be
      // aimux's own, so it casts back rather than re-deriving.
      syncClaudeTheme(
        snapshot.colors as unknown as ResolvedTuiTheme,
        snapshot.mode as unknown as ThemeMode
      )
    }

    // Three moments, one function: the theme changed, the toggle changed, or
    // the plugin just loaded (`watch` fires immediately).
    themes.onChange(pushTheme)
    settings.watch(HARMONIZE_THEME_ROW, pushTheme)

    settings.watch(CLAUDE_HOOKS_ROW, (value) => {
      // Idempotent, and one-way: turning the row off leaves what was written
      // in place, which is what the row's "needs a restart" marker has always
      // meant. Turning it on now takes effect without one.
      if (value === true) ensureClaudeSettingsHooks()
    })

    ctx.log.info('claude integration active')
  },
})

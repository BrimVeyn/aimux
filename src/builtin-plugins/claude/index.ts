import { PLUGIN_API_VERSION } from '@brimveyn/aimux-plugin'

import type { BuiltinPlugin } from '../../plugins/builtin'

/**
 * Claude Code integration: the aimux theme written into `~/.claude`, and the
 * hook entries that let Claude report its own activity instead of aimux
 * reading the screen.
 *
 * UI half only. Both writes are about the *user's* Claude configuration, and
 * the UI is the process that knows which theme is on screen.
 */
export const CLAUDE_PLUGIN: BuiltinPlugin = {
  halves: {
    ui: async () => (await import('./ui')).default,
  },
  manifest: {
    apiVersion: PLUGIN_API_VERSION,
    description: "Write aimux's theme and activity hooks into Claude Code's own settings",
    id: 'aimux.claude',
    name: 'Claude Code integration',
    version: '1.0.0',
  },
}

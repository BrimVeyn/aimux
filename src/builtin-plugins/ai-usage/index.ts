import type { ResolvedConfig } from '@brimveyn/aimux-config'

import { PLUGIN_API_VERSION } from '@brimveyn/aimux-plugin'

import type { BuiltinPlugin } from '../../plugins/builtin'

/**
 * The AI quota tile in the status bar, and the polling behind it.
 *
 * `claudePlan`, `codexWeeklyLimit` and `tools` have no settings row — they are
 * `aimux.config.ts` keys and always were — so they are seeded into
 * `ctx.config` here rather than read by the plugin. The user's configuration
 * did not move; the mapping is one object, in the declaration, where a reader
 * would look for it.
 */
export function aiUsagePlugin(config?: ResolvedConfig): BuiltinPlugin {
  const aiUsage = config?.statusBar?.aiUsage
  return {
    config: {
      ...(aiUsage?.claudePlan === undefined ? {} : { claudePlan: aiUsage.claudePlan }),
      ...(aiUsage?.codexWeeklyLimit === undefined
        ? {}
        : { codexWeeklyLimit: aiUsage.codexWeeklyLimit }),
      ...(aiUsage?.tools === undefined ? {} : { tools: aiUsage.tools }),
    },
    halves: {
      ui: async () => (await import('./ui')).default,
    },
    manifest: {
      apiVersion: PLUGIN_API_VERSION,
      description: 'Claude and Codex quota in the status bar, polled in the background',
      id: 'aimux.ai-usage',
      name: 'AI usage',
      version: '1.0.0',
    },
  }
}

import type { ResolvedConfig } from '@brimveyn/aimux-config'

import { PLUGIN_API_VERSION } from '@brimveyn/aimux-plugin'

import type { BuiltinPlugin } from '../../plugins/builtin'

/**
 * Naming a tab after the first thing the user asked it.
 *
 * The third built-in, and the one that proves the daemon API rather than the
 * UI one: it reacts to an event, calls a model, and writes a tab's title —
 * with no privileged access to any of the three. What stayed in aimux is what
 * a tab *is*; what moved is every decision about what to call it.
 *
 * Its settings do not move either: `autoRename.*` in `aimux.config.ts` is
 * still where they live, seeded into `ctx.config` here. `models` is a record,
 * which a manifest `config` schema cannot describe, so it is seeded rather
 * than declared — the same reason `ai-usage` seeds its own.
 */
export function autoRenamePlugin(config?: ResolvedConfig): BuiltinPlugin {
  const autoRename = config?.autoRename
  return {
    config: {
      enabled: autoRename?.enabled ?? false,
      ...(autoRename?.maxAttempts === undefined ? {} : { maxAttempts: autoRename.maxAttempts }),
      ...(autoRename?.minPromptWords === undefined
        ? {}
        : { minPromptWords: autoRename.minPromptWords }),
      models: autoRename?.models ?? {},
      ...(autoRename?.settleMs === undefined ? {} : { settleMs: autoRename.settleMs }),
      timeoutMs: autoRename?.timeoutMs ?? 15_000,
    },
    halves: {
      daemon: async () => (await import('./daemon')).default,
    },
    manifest: {
      apiVersion: PLUGIN_API_VERSION,
      description: 'Names a tab after the first thing you ask its agent',
      id: 'aimux.auto-rename',
      name: 'Auto-rename',
      version: '1.0.0',
    },
  }
}

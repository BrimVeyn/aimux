import type { ResolvedConfig } from '@brimveyn/aimux-config'

import { PLUGIN_API_VERSION } from '@brimveyn/aimux-plugin'

import type { BuiltinPlugin } from '../../plugins/builtin'

import { getProfileConfigDir } from '../../profile-paths'

/**
 * Who writes aimux's commit messages by default.
 *
 * The fourth built-in, and the one that keeps the commit-message slot honest:
 * aimux's own answer to "what should this commit say" goes through the same
 * `ctx.ui.git.provideCommitMessage` a third-party plugin uses, with no
 * privileged path. A slot whose only user was aimux, wired differently, would
 * be a slot nobody could trust.
 *
 * It registers as a built-in, so a plugin the user installs displaces it and
 * gets the slot back when it unloads.
 *
 * `profileConfigRoot` is seeded because the briefing template is a file the
 * user edits under their profile — the plugin needs the path, not the notion
 * of a profile.
 */
export function autoCommitPlugin(config?: ResolvedConfig): BuiltinPlugin {
  const autoCommit = config?.autoCommit
  return {
    config: {
      models: autoCommit?.models ?? {},
      profileConfigRoot: getProfileConfigDir(),
      timeoutMs: autoCommit?.timeoutMs ?? 60_000,
    },
    halves: {
      ui: async () => (await import('./ui')).default,
    },
    manifest: {
      apiVersion: PLUGIN_API_VERSION,
      description: 'Writes the commit message aimux suggests, by asking your assistant',
      id: 'aimux.auto-commit',
      name: 'Auto-commit messages',
      version: '1.0.0',
    },
  }
}

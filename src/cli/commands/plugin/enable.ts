import type { CliCommand } from '../../registry'

import { setPluginEnabled } from '../../../plugins/registry-file'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'
import { notifyDaemon, requireRegistryEntry } from './shared'

/**
 * Enable and disable are one implementation: a disabled plugin stays
 * registered and configured, it just never loads. That is what makes
 * "is this plugin the problem?" a one-command question with a one-command
 * answer, instead of an unlink/relink round trip that loses its config.
 */
function toggle(verb: 'enable' | 'disable'): CliCommand {
  const enabled = verb === 'enable'
  return {
    args: [{ complete: { kind: 'none' }, name: 'id', required: true }],
    flags: SHARED_FLAGS,
    group: 'plugin',
    run: async (ctx) => {
      const id = ctx.args.positionals[0] ?? ''
      requireRegistryEntry(id)
      setPluginEnabled(id, enabled)
      const refreshed = await notifyDaemon(ctx.getDaemon, 'refresh')
      writeJson({
        daemon: refreshed.ok ? 'refreshed' : (refreshed.detail ?? 'unreachable'),
        enabled,
        id,
      })
      return EXIT_OK
    },
    summary: enabled
      ? 'Load a registered plugin again'
      : 'Keep a plugin registered but stop loading it',
    verb,
  }
}

export const pluginEnable = toggle('enable')
export const pluginDisable = toggle('disable')

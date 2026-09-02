import type { CliCommand } from '../../registry'

import { setPluginEnabled } from '../../../plugins/registry-file'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, EXIT_RUNTIME, writeError, writeJson } from '../../output'
import { notifyDaemon, requireKnownPlugin } from './shared'

/**
 * Enable and disable are one implementation: a disabled plugin stays
 * registered and configured, it just never loads. That is what makes
 * "is this plugin the problem?" a one-command question with a one-command
 * answer, instead of an unlink/relink round trip that loses its config.
 *
 * It works on any plugin aimux knows — built-in, linked, installed, or
 * declared in `aimux.config.ts` — because the state goes into the registry's
 * `overrides` block, keyed by id, rather than into a row only some of them
 * have.
 */
function toggle(verb: 'enable' | 'disable'): CliCommand {
  const enabled = verb === 'enable'
  return {
    args: [{ complete: { kind: 'dynamic', source: 'plugin' }, name: 'id', required: true }],
    flags: SHARED_FLAGS,
    group: 'plugin',
    run: async (ctx) => {
      const id = ctx.args.positionals[0] ?? ''
      const { record, userEntry } = await requireKnownPlugin(id)

      if (!setPluginEnabled(id, enabled)) {
        writeError('could not write the plugin registry')
        writeJson({ error: 'registry write failed', id, kind: 'write-failed' })
        return EXIT_RUNTIME
      }

      // The write is real and is kept — removing the config line reveals the
      // intent — but it is outranked, and a value that silently does nothing
      // is the one outcome worth a warning.
      const shadowed = userEntry?.enabled !== undefined
      if (shadowed) {
        writeError(`${id}: aimux.config.ts declares \`enabled\` and keeps winning — edit it there`)
      }

      const refreshed = await notifyDaemon(ctx.getDaemon, 'refresh')
      writeJson({
        daemon: refreshed.ok ? 'refreshed' : (refreshed.detail ?? 'unreachable'),
        enabled,
        id,
        shadowedBy: shadowed ? 'aimux.config.ts' : null,
        source: record.source,
        storedIn: 'registry',
      })
      return EXIT_OK
    },
    summary: enabled
      ? 'Load a plugin again — built-in, linked or installed'
      : 'Keep a plugin known but stop loading it',
    verb,
  }
}

export const pluginEnable = toggle('enable')
export const pluginDisable = toggle('disable')

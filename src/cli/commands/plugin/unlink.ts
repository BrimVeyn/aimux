import type { CliCommand } from '../../registry'

import { removePluginRegistryEntry } from '../../../plugins/registry-file'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, EXIT_RUNTIME, writeError, writeJson } from '../../output'
import { notifyRunningDaemon, requireRegistryEntry } from './shared'

/**
 * Drops the registration. The directory is untouched — it was never aimux's
 * to delete, which is exactly the difference from `uninstall`.
 */
export const pluginUnlink: CliCommand = {
  args: [{ complete: { kind: 'dynamic', source: 'plugin' }, name: 'id', required: true }],
  flags: SHARED_FLAGS,
  group: 'plugin',
  run: async (ctx) => {
    const id = ctx.args.positionals[0] ?? ''
    const entry = requireRegistryEntry(id)
    if (entry.source !== 'link') {
      writeError(`"${id}" was installed, not linked — use \`aimux plugin uninstall ${id}\``)
      writeJson({ error: 'not a linked plugin', id, kind: 'wrong-source', source: entry.source })
      return EXIT_RUNTIME
    }

    removePluginRegistryEntry(id)
    const refreshed = await notifyRunningDaemon('refresh')
    writeJson({
      daemon: refreshed.ok ? 'refreshed' : (refreshed.detail ?? 'unreachable'),
      id,
      root: entry.path,
      unlinked: true,
    })
    return EXIT_OK
  },
  summary: 'Unregister a linked plugin (the directory is left alone)',
  verb: 'unlink',
}

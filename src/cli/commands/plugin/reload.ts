import type { CliCommand } from '../../registry'

import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, EXIT_RUNTIME, writeError, writeJson } from '../../output'
import { notifyDaemon } from './shared'

/**
 * The manual half of hot reload — the same code path the file watcher takes,
 * for when the watcher is off (`AIMUX_PLUGIN_WATCH=0`) or the change came from
 * outside the plugin directory.
 *
 * The daemon reloads its own halves and forwards the instruction to every
 * attached UI, so one command reloads both processes.
 */
export const pluginReload: CliCommand = {
  args: [{ complete: { kind: 'dynamic', source: 'plugin' }, name: 'id' }],
  flags: SHARED_FLAGS,
  group: 'plugin',
  run: async (ctx) => {
    const id = ctx.args.positionals[0]
    const outcome = await notifyDaemon(ctx.getDaemon, 'reload', id === undefined ? {} : { id })
    if (!outcome.ok) {
      writeError(`reload failed: ${outcome.detail ?? 'daemon unreachable'}`)
      writeJson({ error: outcome.detail ?? 'daemon unreachable', kind: 'reload-failed' })
      return EXIT_RUNTIME
    }
    writeJson({ id: id ?? null, reloaded: true, result: outcome.result })
    return EXIT_OK
  },
  summary: 'Reload one plugin, or every plugin, in the daemon and every UI',
  verb: 'reload',
}

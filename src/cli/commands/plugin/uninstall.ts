import { rmSync } from 'node:fs'

import type { CliCommand } from '../../registry'

import { getPluginConfigDir, getPluginStateDir } from '../../../plugins/paths'
import { removePluginRegistryEntry } from '../../../plugins/registry-file'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, EXIT_RUNTIME, writeError, writeJson } from '../../output'
import { notifyRunningDaemon, requireRegistryEntry } from './shared'

/**
 * Deletes the managed checkout. State goes with it — it is a cache by
 * definition — but **config does not**, unless `--purge` says so: reinstalling
 * a plugin and finding your API token still there is the behaviour people
 * expect, and re-entering it because a version bump needed a reinstall is not.
 */
export const pluginUninstall: CliCommand = {
  args: [{ complete: { kind: 'dynamic', source: 'plugin' }, name: 'id', required: true }],
  flags: [
    ...SHARED_FLAGS,
    { description: 'Also delete the plugin config directory', kind: 'boolean', name: 'purge' },
  ],
  group: 'plugin',
  run: async (ctx) => {
    const id = ctx.args.positionals[0] ?? ''
    const entry = requireRegistryEntry(id)
    if (entry.source !== 'install') {
      writeError(`"${id}" was linked, not installed — use \`aimux plugin unlink ${id}\``)
      writeJson({
        error: 'not an installed plugin',
        id,
        kind: 'wrong-source',
        source: entry.source,
      })
      return EXIT_RUNTIME
    }

    const purge = ctx.args.flags.purge === true
    removePluginRegistryEntry(id)
    rmSync(entry.path, { force: true, recursive: true })
    rmSync(getPluginStateDir(id), { force: true, recursive: true })
    if (purge) rmSync(getPluginConfigDir(id), { force: true, recursive: true })

    const refreshed = await notifyRunningDaemon('refresh')
    writeJson({
      configKept: !purge,
      daemon: refreshed.ok ? 'refreshed' : (refreshed.detail ?? 'unreachable'),
      id,
      removed: entry.path,
      uninstalled: true,
    })
    return EXIT_OK
  },
  summary: 'Remove an installed plugin and its state',
  verb: 'uninstall',
}

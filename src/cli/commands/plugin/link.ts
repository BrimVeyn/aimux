import type { CliCommand } from '../../registry'

import { runPluginBuild } from '../../../plugins/build'
import { upsertPluginRegistryEntry } from '../../../plugins/registry-file'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, EXIT_RUNTIME, writeError, writeJson } from '../../output'
import { notifyRunningDaemon, readManifestOrThrow, resolvePluginRoot } from './shared'

/**
 * Registers a development checkout in place. Unlike `install` it copies
 * nothing: the directory stays the user's, and it is watched for edits, which
 * is the whole author loop — `link` once, then save and watch it reload.
 */
export const pluginLink: CliCommand = {
  args: [{ complete: { kind: 'file' }, name: 'path', required: true }],
  flags: [
    ...SHARED_FLAGS,
    { description: 'Skip the manifest `build` steps', kind: 'boolean', name: 'no-build' },
  ],
  group: 'plugin',
  run: async (ctx) => {
    const root = resolvePluginRoot(ctx.args.positionals[0] ?? '')
    const manifest = await readManifestOrThrow(root)

    const build =
      ctx.args.flags['no-build'] === true
        ? { ran: [], skipped: true as const }
        : await runPluginBuild(manifest, root)
    if ('failed' in build && build.failed !== undefined) {
      writeError(`build step failed: ${build.failed}`)
      writeJson({ error: build.failed, id: manifest.id, kind: 'build-failed', root })
      return EXIT_RUNTIME
    }

    upsertPluginRegistryEntry({
      enabled: true,
      id: manifest.id,
      path: root,
      source: 'link',
      version: manifest.version,
    })

    const refreshed = await notifyRunningDaemon('refresh')
    writeJson({
      build,
      daemon: refreshed.ok ? 'refreshed' : (refreshed.detail ?? 'unreachable'),
      halves: Object.keys(manifest.entries ?? {}),
      id: manifest.id,
      linked: true,
      root,
      version: manifest.version,
    })
    return EXIT_OK
  },
  summary: 'Register a local plugin directory and watch it for changes',
  verb: 'link',
}

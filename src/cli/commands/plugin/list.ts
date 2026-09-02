import type { CliCommand } from '../../registry'

import { builtinPlugins } from '../../../builtin-plugins'
import { loadUserConfig } from '../../../config/loader'
import { discoverPlugins } from '../../../plugins/discovery'
import { redactPluginConfig } from '../../../plugins/manifest'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'
import { notifyDaemon } from './shared'

/**
 * Two answers in one: what is registered (authoritative, always available) and
 * what is actually running (only when the daemon is up). They disagree exactly
 * when something is wrong — a plugin that failed to apply, or one linked since
 * the daemon last looked — which is what the user came to find out.
 *
 * The first answer runs the same discovery the hosts do, `aimux.config.ts` and
 * shipped plugins included. Anything less would make the list disagree with
 * reality for two whole categories of plugin: one declared inline in the
 * config file, and one that ships with aimux.
 */
export const pluginList: CliCommand = {
  args: [],
  flags: SHARED_FLAGS,
  group: 'plugin',
  run: async (ctx) => {
    const { resolved } = await loadUserConfig()
    const { issues, records } = await discoverPlugins(
      resolved.plugins,
      undefined,
      builtinPlugins(resolved)
    )
    const live = await notifyDaemon(ctx.getDaemon, 'list')
    const statuses =
      live.ok && typeof live.result === 'object' && live.result !== null
        ? ((live.result as { plugins?: unknown }).plugins ?? null)
        : null

    writeJson({
      daemon: live.ok ? 'connected' : (live.detail ?? 'unreachable'),
      issues: issues.map((issue) => issue.message),
      plugins: records.map((record) => ({
        config: redactPluginConfig(record.manifest, record.config),
        enabled: record.enabled,
        halves: Object.keys(record.manifest.entries ?? {}),
        id: record.id,
        name: record.manifest.name ?? record.id,
        root: record.root,
        source: record.source,
        version: record.manifest.version,
      })),
      running: statuses,
    })
    return EXIT_OK
  },
  summary: 'List registered plugins and their live state',
  verb: 'list',
}

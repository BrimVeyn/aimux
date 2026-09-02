import type { CliCommand } from '../../registry'

import { discoverPlugins } from '../../../plugins/discovery'
import { redactPluginConfig } from '../../../plugins/manifest'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'
import { notifyDaemon } from './shared'

/**
 * Two answers in one: what is registered on disk (authoritative, always
 * available) and what is actually running (only when the daemon is up). They
 * disagree exactly when something is wrong — a plugin that failed to apply, or
 * one linked since the daemon last looked — which is what the user came to
 * find out.
 */
export const pluginList: CliCommand = {
  args: [],
  flags: SHARED_FLAGS,
  group: 'plugin',
  run: async (ctx) => {
    const { issues, records } = await discoverPlugins()
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

import type { PluginStatus } from '../../../plugins/types'
import type { CliCommand } from '../../registry'

import { redactPluginConfig } from '../../../plugins/manifest'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'
import { discoverAllPlugins, notifyDaemon } from './shared'

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
    const { issues, records } = await discoverAllPlugins()
    const live = await notifyDaemon(ctx.getDaemon, 'list')
    const statuses =
      live.ok && typeof live.result === 'object' && live.result !== null
        ? ((live.result as { plugins?: PluginStatus[] }).plugins ?? null)
        : null

    /** The fiber state per host, or null where this plugin runs no half. */
    const stateOf = (id: string, halves: string[]): Record<string, string | null> => {
      const state: Record<string, string | null> = { daemon: null, ui: null }
      for (const host of halves) state[host] = 'not-running'
      for (const status of statuses ?? []) {
        if (status.id === id) state[status.host] = status.state
      }
      return state
    }

    const firstError = (id: string): string | null =>
      (statuses ?? []).find((status) => status.id === id && status.error !== undefined)?.error ??
      null

    writeJson({
      daemon: live.ok ? 'connected' : (live.detail ?? 'unreachable'),
      issues: issues.map((issue) => issue.message),
      plugins: records.map((record) => {
        const halves = Object.keys(record.manifest.entries ?? {})
        return {
          config: redactPluginConfig(record.manifest, record.config),
          enabled: record.enabled,
          // Which layer decided: an agent about to run `plugin disable` needs
          // to know whether `aimux.config.ts` will overrule it at next launch.
          enabledFrom: record.enabledFrom,
          error: firstError(record.id),
          halves,
          hasConfigSchema: Object.keys(record.manifest.config ?? {}).length > 0,
          id: record.id,
          name: record.manifest.name ?? record.id,
          root: record.root,
          source: record.source,
          state: stateOf(record.id, halves),
          version: record.manifest.version,
        }
      }),
      // The raw statuses, unchanged: scripts written against them still work.
      running: statuses,
    })
    return EXIT_OK
  },
  summary: 'List every known plugin, its state and its config',
  verb: 'list',
}

import type { PluginStatus } from '../../../plugins/types'
import type { CliCommand } from '../../registry'

import { describePluginConfig, undeclaredKeys } from '../../../plugins/config-origin'
import { readPluginLog } from '../../../plugins/log'
import { getPluginOverride } from '../../../plugins/registry-file'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'
import { notifyRunningDaemon, requireKnownPlugin } from './shared'

/**
 * Everything about one plugin, in one call: what it is, what it resolved to,
 * what each half is doing, and what it has been saying.
 *
 * "Why did this fail" used to take three commands and a comparison — `plugin
 * list` for the state, `plugin config` for the values, `plugin log` for the
 * error — and the answer is usually in the intersection.
 *
 * Exit stays `0` when the plugin has failed: the query succeeded, and the
 * caller reads `state`. An exit code that meant "the plugin is broken" would
 * be indistinguishable from "the question was wrong".
 */
export const pluginShow: CliCommand = {
  args: [{ complete: { kind: 'dynamic', source: 'plugin' }, name: 'id', required: true }],
  flags: [
    ...SHARED_FLAGS,
    { description: 'How many log lines to include (default 20)', kind: 'number', name: 'lines' },
    {
      complete: { kind: 'values', values: ['debug', 'info', 'warn', 'error'] },
      description: 'Only log lines at this level or above',
      kind: 'string',
      name: 'level',
    },
  ],
  group: 'plugin',
  run: async (ctx) => {
    const id = ctx.args.positionals[0] ?? ''
    const { issues, record, userEntry } = await requireKnownPlugin(id)

    const live = await notifyRunningDaemon('list')
    const statuses =
      live.ok && typeof live.result === 'object' && live.result !== null
        ? ((live.result as { plugins?: PluginStatus[] }).plugins ?? [])
        : []
    const mine = statuses.filter((status) => status.id === id)

    const halves = Object.keys(record.manifest.entries ?? {})
    const state: Record<string, string | null> = { daemon: null, ui: null }
    for (const host of halves) state[host] = 'not-running'
    for (const status of mine) state[status.host] = status.state

    const level = ctx.args.flags.level
    const lines = ctx.args.flags.lines

    writeJson({
      apiVersion: record.manifest.apiVersion,
      config: describePluginConfig(record.manifest, record.config, {
        ...(getPluginOverride(id) === undefined ? {} : { override: getPluginOverride(id) }),
        ...(userEntry?.config === undefined ? {} : { userConfig: userEntry.config }),
      }),
      daemon: live.ok ? 'connected' : (live.detail ?? 'unreachable'),
      enabled: record.enabled,
      enabledFrom: record.enabledFrom,
      errors: mine
        .filter((status) => status.error !== undefined)
        .map((status) => ({ host: status.host, message: status.error })),
      extraKeys: undeclaredKeys(record.manifest, record.config),
      halves,
      id,
      // Only the issues naming this plugin: the rest belong to `plugin list`.
      issues: issues.filter((issue) => issue.id === id).map((issue) => issue.message),
      log: readPluginLog(id, {
        lines: typeof lines === 'number' ? lines : 20,
        ...(typeof level === 'string' ? { level: level as 'debug' } : {}),
      }),
      missing: mine.flatMap((status) => status.missing ?? []),
      name: record.manifest.name ?? id,
      paths: record.paths,
      root: record.root,
      source: record.source,
      state,
      version: record.manifest.version,
    })
    return EXIT_OK
  },
  summary: 'Everything about one plugin: state, config, errors and its log',
  verb: 'show',
}

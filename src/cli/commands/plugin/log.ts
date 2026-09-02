import type { CliCommand } from '../../registry'

import { type PluginLogLevel, readPluginLog } from '../../../plugins/log'
import { getPluginLogPath } from '../../../plugins/paths'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'

const LEVELS = new Set(['debug', 'info', 'warn', 'error'])

/**
 * A plugin's own log — where `ctx.log` writes and where a failed `apply`
 * leaves its stack. The one place an author looks when a plugin is `FAILED`
 * and the toast has scrolled away.
 */
export const pluginLog: CliCommand = {
  args: [{ complete: { kind: 'none' }, name: 'id', required: true }],
  flags: [
    ...SHARED_FLAGS,
    { description: 'Show only the last N lines (default 50)', kind: 'number', name: 'lines' },
    {
      complete: { kind: 'values', values: ['debug', 'info', 'warn', 'error'] },
      description: 'Show only this level',
      kind: 'string',
      name: 'level',
    },
  ],
  group: 'plugin',
  run: async (ctx) => {
    const id = ctx.args.positionals[0] ?? ''
    const lines = typeof ctx.args.flags.lines === 'number' ? ctx.args.flags.lines : 50
    const rawLevel = ctx.args.flags.level
    const level =
      typeof rawLevel === 'string' && LEVELS.has(rawLevel)
        ? (rawLevel as PluginLogLevel)
        : undefined

    const entries = readPluginLog(id, { lines, ...(level === undefined ? {} : { level }) })
    writeJson({ entries, id, path: getPluginLogPath(id) })
    return EXIT_OK
  },
  summary: "Print a plugin's log",
  verb: 'log',
}

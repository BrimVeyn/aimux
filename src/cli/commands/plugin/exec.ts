import type { CliCommand } from '../../registry'

import { PLUGIN_CONTROL_EXEC_LIST, PLUGIN_CONTROL_EXEC_RUN } from '../../../plugins/rpc-envelope'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, EXIT_RUNTIME, writeError, writeJson } from '../../output'
import { notifyDaemon } from './shared'

/**
 * Runs a command a manifest declares — the "written in any language" half of
 * the plugin system.
 *
 * The spawn happens in the daemon, not here, so the same command is reachable
 * from an event or a keybinding and not only from a shell. One implementation,
 * two entry points.
 */
export const pluginExec: CliCommand = {
  args: [
    { complete: { kind: 'none' }, name: 'plugin-id', required: true },
    { complete: { kind: 'none' }, name: 'command-id', required: true },
  ],
  flags: SHARED_FLAGS,
  group: 'plugin',
  run: async (ctx) => {
    const [pluginId = '', commandId = '', ...args] = ctx.args.positionals
    const outcome = await notifyDaemon(ctx.getDaemon, PLUGIN_CONTROL_EXEC_RUN, {
      args,
      commandId,
      pluginId,
    })
    if (!outcome.ok) {
      writeError(outcome.detail ?? 'plugin exec failed')
      writeJson({ error: outcome.detail ?? 'plugin exec failed', kind: 'runtime-error' })
      return EXIT_RUNTIME
    }

    const result = outcome.result as {
      exitCode?: number
      stderr?: string
      timedOut?: boolean
    }
    writeJson(outcome.result ?? {})
    // The command's exit code is its answer, so it becomes ours — an
    // orchestrator scripting `aimux plugin exec` reads the same number the
    // command produced rather than a wrapper's.
    if (result.timedOut === true) writeError(`${pluginId} ${commandId}: timed out`)
    else if ((result.exitCode ?? 0) !== 0 && result.stderr !== undefined && result.stderr !== '') {
      writeError(result.stderr.trim())
    }
    return result.exitCode === 0 || result.exitCode === undefined ? EXIT_OK : EXIT_RUNTIME
  },
  summary: 'Run a command a plugin manifest declares',
  verb: 'exec',
}

export const pluginCommands: CliCommand = {
  args: [],
  flags: SHARED_FLAGS,
  group: 'plugin',
  run: async (ctx) => {
    const outcome = await notifyDaemon(ctx.getDaemon, PLUGIN_CONTROL_EXEC_LIST)
    if (!outcome.ok) {
      writeError(outcome.detail ?? 'daemon unreachable')
      writeJson({ error: outcome.detail ?? 'daemon unreachable', kind: 'runtime-error' })
      return EXIT_RUNTIME
    }
    writeJson(outcome.result ?? { commands: [] })
    return EXIT_OK
  },
  summary: 'List the commands plugin manifests declare',
  verb: 'commands',
}

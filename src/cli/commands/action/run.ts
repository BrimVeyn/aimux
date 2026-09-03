import type { CliCommand } from '../../registry'

import { PLUGIN_CONTROL_ACTION_RUN } from '../../../plugins/rpc-envelope'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, EXIT_RUNTIME, EXIT_USAGE, writeError, writeJson } from '../../output'
import { notifyDaemon } from '../plugin/shared'

/**
 * Fires a plugin action by its qualified name, exactly as its key would.
 *
 * The result travels the same two channels a key press produces — actions to
 * the reducer, effects to the side-effect runner — so this and the keybinding
 * cannot drift apart. That is what makes it a test rather than a back door: a
 * pane can be opened, a gear engaged, and the outcome checked with
 * `aimux ui state`, without anyone touching a keyboard.
 *
 * `aimux plugin exec` is the other half of this pair, and stays separate: that
 * one spawns a subprocess a manifest declared, this one runs code inside the UI.
 */
export const actionRun: CliCommand = {
  args: [{ complete: { kind: 'none' }, name: 'action', required: true }],
  flags: SHARED_FLAGS,
  group: 'action',
  run: async (ctx) => {
    const name = ctx.args.positionals[0] ?? ''
    const outcome = await notifyDaemon(ctx.getDaemon, PLUGIN_CONTROL_ACTION_RUN, { name })
    if (!outcome.ok) {
      writeError(outcome.detail ?? 'could not reach the daemon')
      writeJson({ error: outcome.detail ?? 'unreachable', kind: 'runtime-error' })
      return EXIT_RUNTIME
    }
    const result = outcome.result as { attached?: boolean; detail?: string; ran?: boolean }
    if (result.attached !== true) {
      writeError(result.detail ?? 'no UI attached')
      writeJson(outcome.result ?? {})
      return EXIT_RUNTIME
    }
    writeJson(outcome.result ?? {})
    // An action nobody registered is a typo, and a typo that exits 0 is how an
    // agent concludes its keybinding works.
    return result.ran === true ? EXIT_OK : EXIT_USAGE
  },
  summary: 'Run a plugin action by qualified name, as its keybinding would',
  verb: 'run',
}

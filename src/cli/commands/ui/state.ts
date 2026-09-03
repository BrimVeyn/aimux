import type { CliCommand } from '../../registry'

import { PLUGIN_CONTROL_UI_STATE } from '../../../plugins/rpc-envelope'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, EXIT_RUNTIME, writeError, writeJson } from '../../output'
import { notifyDaemon } from '../plugin/shared'

/**
 * What aimux is actually showing.
 *
 * `plugin show` answers "did it load"; this answers "is it on the screen" —
 * which bar its widget is in, whether anything can draw it, which mode the
 * keyboard is in. Without it an agent that places a widget has no way to be
 * wrong, and a plugin that loaded perfectly but landed nowhere looks identical
 * to one that worked.
 *
 * The daemon forwards it: only the process drawing the screen knows any of it.
 */
export const uiState: CliCommand = {
  args: [],
  flags: SHARED_FLAGS,
  group: 'ui',
  run: async (ctx) => {
    const outcome = await notifyDaemon(ctx.getDaemon, PLUGIN_CONTROL_UI_STATE)
    if (!outcome.ok) {
      writeError(outcome.detail ?? 'could not reach the daemon')
      writeJson({ error: outcome.detail ?? 'unreachable', kind: 'runtime-error' })
      return EXIT_RUNTIME
    }
    const result = outcome.result as { attached?: boolean; detail?: string }
    if (result.attached !== true) {
      writeError(result.detail ?? 'no UI attached')
      writeJson(outcome.result ?? {})
      return EXIT_RUNTIME
    }
    writeJson(outcome.result ?? {})
    return EXIT_OK
  },
  summary: 'What the interface is showing: bars, widgets, status bar, mode',
  verb: 'state',
}

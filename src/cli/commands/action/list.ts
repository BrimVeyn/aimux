import type { CliCommand } from '../../registry'

import { PLUGIN_CONTROL_ACTION_LIST } from '../../../plugins/rpc-envelope'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, EXIT_RUNTIME, writeError, writeJson } from '../../output'
import { notifyDaemon } from '../plugin/shared'

/**
 * Everything runnable plugins have contributed: actions with their titles,
 * manifest `commands[]`, CLI verbs. The list a palette is built from, and
 * the way an agent checks that the action it registered is findable rather
 * than merely registered.
 */
export const actionList: CliCommand = {
  args: [],
  flags: SHARED_FLAGS,
  group: 'action',
  run: async (ctx) => {
    const outcome = await notifyDaemon(ctx.getDaemon, PLUGIN_CONTROL_ACTION_LIST, {})
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
  summary: 'List every action, command and CLI verb plugins contribute',
  verb: 'list',
}

import type { CliCommand } from '../../registry'

import { PLUGIN_CONTROL_KEYMAP_RESOLVE } from '../../../plugins/rpc-envelope'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, EXIT_RUNTIME, writeError, writeJson } from '../../output'
import { notifyDaemon } from '../plugin/shared'

/**
 * What a key does, and where that came from.
 *
 * A plugin's binding can be applied, or refused because the user's config
 * already owns the key — and from the outside those look the same: the key just
 * does something, or doesn't. `origin` is the answer, and it is the keyboard's
 * version of `enabledFrom`, which earned its place for the same reason.
 *
 * Not being bound is an answer, not a failure: exit 0, `bound: false`.
 */
export const keymapResolve: CliCommand = {
  args: [{ complete: { kind: 'none' }, name: 'keys', required: true }],
  flags: [
    ...SHARED_FLAGS,
    {
      complete: { kind: 'none' },
      description: 'Mode to look in; defaults to the mode the keyboard is in',
      kind: 'string',
      name: 'mode',
    },
  ],
  group: 'keymap',
  run: async (ctx) => {
    const keys = ctx.args.positionals[0] ?? ''
    const mode = ctx.args.flags.mode
    const outcome = await notifyDaemon(ctx.getDaemon, PLUGIN_CONTROL_KEYMAP_RESOLVE, {
      keys,
      ...(typeof mode === 'string' && mode !== '' ? { mode } : {}),
    })
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
  summary: 'What a key sequence resolves to, and whether config or a plugin bound it',
  verb: 'resolve',
}

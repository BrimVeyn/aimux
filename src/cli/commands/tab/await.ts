/**
 * `aimux tab await <tabId>` — block until a tab's in-flight turn ends or the
 * worker asks, without submitting anything. It's the standalone half of
 * `tab run` for turns you started by hand (a `tab send --enter`, or a worker you
 * nudged), sharing `awaitTurn` so the outcome JSON and exit codes are identical.
 *
 * The turn-lifecycle events fire only on transitions, so `awaitTurn` is seeded
 * from the attach replay: a tab already `working` won't emit another `working`
 * transition (assume it), an already-`waiting-input` tab's `tabQuestion` already
 * fired (short-circuit with a best-effort snapshot tail), and an `idle` tab is
 * awaited for a *fresh* working→idle cycle so a stale, already-finished turn is
 * never re-reported as "completed".
 */
import type { CliCommand } from '../../registry'

import {
  IPC_CAPABILITY_QUESTION_EVENTS,
  IPC_CAPABILITY_THIN_ATTACH,
  IPC_CAPABILITY_TURN_LIFECYCLE,
} from '../../../ipc/protocol'
import { SHARED_FLAGS } from '../../flags'
import { writeJson } from '../../output'
import { snapshotTailLines } from '../../snapshot-render'
import { awaitTurn, DEFAULT_TIMEOUT_MS, type TurnOutcome, turnOutcomeExitCode } from './await-turn'

/** Lines of rendered tail to attach as the question text on a replay short-circuit. */
const QUESTION_TAIL_LINES = 25

export const tabAwait: CliCommand = {
  args: [{ complete: { kind: 'dynamic', source: 'tab' }, name: 'tabId', required: true }],
  flags: [
    ...SHARED_FLAGS,
    {
      description: 'overall turn cap in milliseconds (default 900000 = 15 min)',
      kind: 'number',
      name: 'timeout',
    },
  ],
  group: 'tab',
  run: async (ctx) => {
    const tabId = ctx.args.positionals[0]
    if (typeof tabId !== 'string' || tabId.length === 0) {
      throw new Error('tabId is required')
    }
    const timeoutMs =
      typeof ctx.args.flags.timeout === 'number' ? ctx.args.flags.timeout : DEFAULT_TIMEOUT_MS

    const workspace = ctx.getWorkspace()
    const daemon = await ctx.getDaemon()
    if (
      !daemon.hasCapability(IPC_CAPABILITY_THIN_ATTACH) ||
      !daemon.hasCapability(IPC_CAPABILITY_TURN_LIFECYCLE) ||
      !daemon.hasCapability(IPC_CAPABILITY_QUESTION_EVENTS)
    ) {
      throw new Error(
        'daemon predates tab await (turnLifecycle/questionEvents) — restart aimux to pick up the new daemon'
      )
    }

    const attach = await daemon.attach({ cols: 0, projectId: workspace.id, rows: 0, thin: true })
    const tab = attach.tabs.find((t) => t.id === tabId)
    if (!tab) {
      // Exit 3 (runtime) via runCli — NOT 4, which is reserved for
      // daemon-unreachable. A driver reads "tab not found" as the re-spawn signal.
      throw new Error(`tab not found: ${tabId}`)
    }

    if (tab.activity === 'waiting-input') {
      // The tabQuestion event fired before we attached and won't re-fire.
      // Reconstruct a best-effort prompt from the rendered tail (the real
      // kind/options aren't recoverable from a replay).
      const question =
        tab.viewport && tab.viewport.lines.length > 0
          ? snapshotTailLines(tab.viewport, QUESTION_TAIL_LINES, { trim: true }).join('\n')
          : ''
      const outcome: TurnOutcome = {
        durationMs: 0,
        kind: 'question',
        outcome: 'question',
        question,
      }
      writeJson(outcome)
      return turnOutcomeExitCode(outcome)
    }

    const outcome = await awaitTurn({
      assumeWorking: tab.activity === 'working',
      daemon,
      tabId,
      timeoutMs,
    })
    writeJson(outcome)
    return turnOutcomeExitCode(outcome)
  },
  summary: "Block until a tab's in-flight turn completes or the worker asks",
  verb: 'await',
}

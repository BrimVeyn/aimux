/**
 * `aimux tab run <tabId>` — the one authoritative verb an orchestrator needs to
 * drive a worker turn. It collapses the spawn→send→uptake→await→snapshot chain
 * into a single event-driven call: stage the prompt, submit it, then block on
 * the daemon's v13 turn-lifecycle events (`tabTurnComplete` / `tabQuestion`)
 * until the turn ends, the worker asks something, the tab dies, or the overall
 * timeout trips. Exactly one JSON object is emitted and the exit code encodes
 * the outcome, so a driver can branch without re-snapshotting the screen.
 */
import type { CliCommand } from '../../registry'

import {
  IPC_CAPABILITY_QUESTION_EVENTS,
  IPC_CAPABILITY_THIN_ATTACH,
  IPC_CAPABILITY_TURN_LIFECYCLE,
} from '../../../ipc/protocol'
import { SHARED_FLAGS } from '../../flags'
import { writeJson } from '../../output'
import { awaitTurn, DEFAULT_TIMEOUT_MS, turnOutcomeExitCode } from './await-turn'
import { buildPromptPayload, writePromptPayload } from './prompt-io'

/**
 * Resolve the prompt text from exactly one source. We require exactly one of
 * `--prompt-file`, `--stdin`, or the positional `[text]` so an orchestrator
 * never silently sends the wrong buffer when two sources are set (e.g. a stale
 * positional plus a fresh `--prompt-file`).
 */
async function resolvePromptText(
  promptFile: string | undefined,
  fromStdin: boolean,
  positionalText: string | undefined
): Promise<string> {
  const sources = [promptFile !== undefined, fromStdin, positionalText !== undefined].filter(
    (present) => present
  ).length
  if (sources !== 1) {
    throw new Error(
      'provide exactly one prompt source: --prompt-file <f>, --stdin, or a [text] positional'
    )
  }
  if (promptFile !== undefined) return Bun.file(promptFile).text()
  if (fromStdin) return Bun.stdin.text()
  return positionalText ?? ''
}

export const tabRun: CliCommand = {
  args: [{ name: 'tabId', required: true }, { name: 'text' }],
  flags: [
    ...SHARED_FLAGS,
    { description: 'read the prompt from this file', kind: 'string', name: 'prompt-file' },
    { description: 'read the prompt from stdin', kind: 'boolean', name: 'stdin' },
    {
      description: 'overall turn cap in milliseconds (default 900000 = 15 min)',
      kind: 'number',
      name: 'timeout',
    },
    {
      description: 'stage the prompt without submitting (still waits)',
      kind: 'boolean',
      name: 'no-enter',
    },
  ],
  group: 'tab',
  run: async (ctx) => {
    const tabId = ctx.args.positionals[0]
    if (typeof tabId !== 'string' || tabId.length === 0) {
      throw new Error('tabId is required')
    }

    const promptFile =
      typeof ctx.args.flags['prompt-file'] === 'string' ? ctx.args.flags['prompt-file'] : undefined
    const fromStdin = ctx.args.flags.stdin === true
    const text = await resolvePromptText(promptFile, fromStdin, ctx.args.positionals[1])

    const timeoutMs =
      typeof ctx.args.flags.timeout === 'number' ? ctx.args.flags.timeout : DEFAULT_TIMEOUT_MS
    const appendEnter = ctx.args.flags['no-enter'] !== true

    const workspace = ctx.getWorkspace()
    const daemon = await ctx.getDaemon()
    if (
      !daemon.hasCapability(IPC_CAPABILITY_THIN_ATTACH) ||
      !daemon.hasCapability(IPC_CAPABILITY_TURN_LIFECYCLE) ||
      !daemon.hasCapability(IPC_CAPABILITY_QUESTION_EVENTS)
    ) {
      throw new Error(
        'daemon predates tab run (turnLifecycle/questionEvents) — restart aimux to pick up the new daemon'
      )
    }

    const attach = await daemon.attach({ cols: 0, rows: 0, sessionId: workspace.id, thin: true })
    if (!attach.tabs.some((t) => t.id === tabId)) {
      throw new Error(`tab not found: ${tabId}`)
    }

    const payload = buildPromptPayload(text, false)

    // Submit inside `onArmed` so subscriptions are live before the worker starts
    // its turn; `assumeWorking: false` keeps the uptake guard, so a lingering
    // pre-submit idle can't be misread as completion.
    const outcome = await awaitTurn({
      assumeWorking: false,
      daemon,
      onArmed: async () => {
        await writePromptPayload(daemon, tabId, payload, appendEnter)
      },
      tabId,
      timeoutMs,
    })
    writeJson(outcome)
    return turnOutcomeExitCode(outcome)
  },
  summary: 'Submit a prompt and block until the turn completes or the worker asks',
  verb: 'run',
}

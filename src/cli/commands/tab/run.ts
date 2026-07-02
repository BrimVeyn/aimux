/**
 * `aimux tab run <tabId>` — the one authoritative verb an orchestrator needs to
 * drive a worker turn. It collapses the spawn→send→uptake→await→snapshot chain
 * into a single event-driven call: stage the prompt, submit it, then block on
 * the daemon's v13 turn-lifecycle events (`tabTurnComplete` / `tabQuestion`)
 * until the turn ends, the worker asks something, the tab dies, or the overall
 * timeout trips. Exactly one JSON object is emitted and the exit code encodes
 * the outcome, so a driver can branch without re-snapshotting the screen.
 */
import type { QuestionKind } from '../../../state/types'
import type { CliCommand } from '../../registry'

import {
  IPC_CAPABILITY_QUESTION_EVENTS,
  IPC_CAPABILITY_THIN_ATTACH,
  IPC_CAPABILITY_TURN_LIFECYCLE,
} from '../../../ipc/protocol'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, EXIT_QUESTION, EXIT_RUNTIME, EXIT_TIMEOUT, writeJson } from '../../output'
import { buildPromptPayload, writePromptPayload } from './prompt-io'

/** Overall cap on a single turn — 15 min, long enough for a heavy build task. */
const DEFAULT_TIMEOUT_MS = 900_000

/**
 * The four terminal shapes of a `tab run`. Modelled as a discriminated union so
 * the JSON we emit and the exit code we return are derived from one value, and
 * so the outcome→exit mapping can be unit-tested without a live daemon.
 * `durationMs` is measured from prompt submit, not attach, so it reflects the
 * worker's think time rather than our connection overhead.
 */
export type RunOutcome =
  | { durationMs: number; outcome: 'completed' }
  | { durationMs: number; error: string; outcome: 'error' }
  | {
      durationMs: number
      kind: QuestionKind
      options?: string[]
      outcome: 'question'
      question: string
    }
  | { durationMs: number; outcome: 'timeout' }

/**
 * Map an outcome to its process exit code. Pure and total over the union so a
 * driver's `case $?` stays exhaustive: 0 completed, 10 question/permission
 * (worker is blocked and wants input), 3 the tab errored/exited, 124 we hit the
 * overall cap.
 */
export function outcomeExitCode(outcome: RunOutcome): number {
  switch (outcome.outcome) {
    case 'completed':
      return EXIT_OK
    case 'question':
      return EXIT_QUESTION
    case 'error':
      return EXIT_RUNTIME
    case 'timeout':
      return EXIT_TIMEOUT
  }
}

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

    return new Promise<number>((resolve) => {
      // Subscribe BEFORE writing: these events fire only on transitions, so a
      // late subscription would race the worker starting its turn.
      let start = Date.now()
      // Uptake guard. The tab may sit `idle` from a prior turn; a stale
      // `tabTurnComplete` (or the settle window closing on that old idle) must
      // not read as "this turn completed". Only honour completion once we've
      // seen the tab go `working` after our submit.
      let sawWorking = false

      const settle = (outcome: RunOutcome): void => {
        cleanup()
        writeJson(outcome)
        resolve(outcomeExitCode(outcome))
      }
      const durationMs = (): number => Date.now() - start

      const offStatus = daemon.on('tabStatus', (p) => {
        if (p.tabId !== tabId) return
        if (p.status === 'working') sawWorking = true
      })
      const offTurn = daemon.on('tabTurnComplete', (p) => {
        if (p.tabId !== tabId) return
        // Ignore end-of-turn until the worker actually started working, so a
        // lingering pre-submit idle can't be mis-read as completion.
        if (!sawWorking) return
        settle({ durationMs: durationMs(), outcome: 'completed' })
      })
      const offQuestion = daemon.on('tabQuestion', (p) => {
        if (p.tabId !== tabId) return
        // A question is honoured immediately — it can legitimately arrive
        // before `working` (the worker asks before doing anything).
        settle({
          durationMs: durationMs(),
          kind: p.kind,
          options: p.options,
          outcome: 'question',
          question: p.prompt,
        })
      })
      const offExit = daemon.on('tabExit', (p) => {
        if (p.tabId !== tabId) return
        settle({ durationMs: durationMs(), error: `exit ${p.exitCode}`, outcome: 'error' })
      })
      const offError = daemon.on('tabError', (p) => {
        if (p.tabId !== tabId) return
        settle({ durationMs: durationMs(), error: p.message, outcome: 'error' })
      })

      const timer = setTimeout(() => {
        settle({ durationMs: durationMs(), outcome: 'timeout' })
      }, timeoutMs)

      const cleanup = (): void => {
        offStatus()
        offTurn()
        offQuestion()
        offExit()
        offError()
        clearTimeout(timer)
      }

      // Submit after subscribing, then reset the clock so `durationMs` measures
      // the worker's turn rather than our attach/write overhead. On a write
      // failure the tab likely died — surface it as an error outcome rather
      // than sitting idle until the timeout.
      const submit = async (): Promise<void> => {
        try {
          await writePromptPayload(daemon, tabId, payload, appendEnter)
          start = Date.now()
        } catch (error) {
          settle({
            durationMs: durationMs(),
            error: error instanceof Error ? error.message : String(error),
            outcome: 'error',
          })
        }
      }
      void submit()
    })
  },
  summary: 'Submit a prompt and block until the turn completes or the worker asks',
  verb: 'run',
}

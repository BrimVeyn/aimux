/**
 * Shared turn-lifecycle waiter behind `tab run` (submit + await) and `tab await`
 * (await only). It subscribes to the daemon's v13 events
 * (`tabStatus`/`tabTurnComplete`/`tabQuestion`/`tabExit`/`tabError`) and settles
 * on the first terminal signal or the overall timeout. Settlement rides the
 * daemon's edge-triggered events — the daemon applies the idle settle window
 * before emitting `tabTurnComplete`, and `tabQuestion` fires only on a real
 * transition into `waiting-input` with daemon-captured text — so this never
 * scrapes the screen and can't misread a working footer as a prompt.
 */
import type { QuestionKind } from '../../../state/types'
import type { DaemonClient } from '../../client/daemon-client'

import { EXIT_OK, EXIT_QUESTION, EXIT_RUNTIME, EXIT_TIMEOUT } from '../../output'

/** Overall cap on a single turn — 15 min, long enough for a heavy build task. */
export const DEFAULT_TIMEOUT_MS = 900_000

/**
 * The four terminal shapes of a turn. A discriminated union so the JSON emitted
 * and the exit code returned derive from one value, and the outcome→exit map is
 * unit-testable without a live daemon. `durationMs` is measured from the moment
 * the turn is armed (post-submit for `tab run`, from attach for `tab await`).
 */
export type TurnOutcome =
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
 * (worker blocked wanting input), 3 the tab errored/exited, 124 overall cap.
 */
export function turnOutcomeExitCode(outcome: TurnOutcome): number {
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

export interface AwaitTurnOptions {
  daemon: DaemonClient
  tabId: string
  timeoutMs: number
  /**
   * Seed the uptake guard. `tab run` passes `false` — only a post-submit
   * `working` transition validates completion, so a lingering pre-submit idle
   * can't be misread as "done". `tab await` passes `true` when the attach replay
   * already shows the tab `working`: no future `working` transition will fire for
   * a turn already in flight, so an unseeded guard would hang to timeout.
   */
  assumeWorking: boolean
  /**
   * Runs once all subscriptions are armed; the duration clock resets when it
   * resolves. `tab run` submits the prompt here. A rejection settles as an
   * `error` outcome (the tab likely died mid-write). `tab await` omits it.
   */
  onArmed?: () => Promise<void>
}

/**
 * Subscribe to the turn-lifecycle events and resolve with the first terminal
 * outcome. Callers own emitting the JSON and returning `turnOutcomeExitCode`.
 */
// `async` only to satisfy promise-function-async; the body has no `await`, so
// the Promise executor below still runs synchronously and subscriptions are
// armed before this returns (callers rely on emitting right after the call).
export async function awaitTurn(opts: AwaitTurnOptions): Promise<TurnOutcome> {
  const { assumeWorking, daemon, onArmed, tabId, timeoutMs } = opts
  return new Promise<TurnOutcome>((resolve) => {
    // Subscribe BEFORE arming: these events fire only on transitions, so a late
    // subscription would race the worker starting its turn.
    let start = Date.now()
    let sawWorking = assumeWorking

    const settle = (outcome: TurnOutcome): void => {
      cleanup()
      resolve(outcome)
    }
    const durationMs = (): number => Date.now() - start

    const offStatus = daemon.on('tabStatus', (p) => {
      if (p.tabId !== tabId) return
      if (p.status === 'working') sawWorking = true
    })
    const offTurn = daemon.on('tabTurnComplete', (p) => {
      if (p.tabId !== tabId) return
      // Ignore end-of-turn until the worker actually started working, so a
      // lingering pre-arm idle can't be mis-read as completion.
      if (!sawWorking) return
      settle({ durationMs: durationMs(), outcome: 'completed' })
    })
    const offQuestion = daemon.on('tabQuestion', (p) => {
      if (p.tabId !== tabId) return
      // A question is honoured immediately — it can legitimately arrive before
      // `working` (the worker asks before doing anything).
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

    // Arm after subscribing, then reset the clock so `durationMs` measures the
    // worker's turn rather than our attach/write overhead. On failure the tab
    // likely died — surface an error outcome rather than sitting to the timeout.
    if (onArmed !== undefined) {
      void (async (): Promise<void> => {
        try {
          await onArmed()
          start = Date.now()
        } catch (error) {
          settle({
            durationMs: durationMs(),
            error: error instanceof Error ? error.message : String(error),
            outcome: 'error',
          })
        }
      })()
    }
  })
}

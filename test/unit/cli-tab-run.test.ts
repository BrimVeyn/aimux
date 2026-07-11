import { describe, expect, test } from 'bun:test'

import { type TurnOutcome, turnOutcomeExitCode } from '../../src/cli/commands/tab/await-turn'
import { EXIT_OK, EXIT_QUESTION, EXIT_RUNTIME, EXIT_TIMEOUT } from '../../src/cli/output'

describe('turn outcome→exit mapping (shared by tab run / tab await)', () => {
  test('completed turn exits 0', () => {
    expect(turnOutcomeExitCode({ durationMs: 12, outcome: 'completed' })).toBe(EXIT_OK)
  })

  test('a question exits 10 so a driver can branch on "worker is blocked"', () => {
    const outcome: TurnOutcome = {
      durationMs: 3,
      kind: 'permission',
      options: ['yes', 'no'],
      outcome: 'question',
      question: 'allow write?',
    }
    expect(turnOutcomeExitCode(outcome)).toBe(EXIT_QUESTION)
  })

  test('a dead/errored tab exits 3', () => {
    expect(turnOutcomeExitCode({ durationMs: 1, error: 'exit 1', outcome: 'error' })).toBe(
      EXIT_RUNTIME
    )
  })

  test('hitting the overall cap exits 124', () => {
    expect(turnOutcomeExitCode({ durationMs: 900_000, outcome: 'timeout' })).toBe(EXIT_TIMEOUT)
  })
})

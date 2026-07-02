import { describe, expect, test } from 'bun:test'

import { outcomeExitCode, type RunOutcome } from '../../src/cli/commands/tab/run'
import { EXIT_OK, EXIT_QUESTION, EXIT_RUNTIME, EXIT_TIMEOUT } from '../../src/cli/output'

describe('tab run outcome→exit mapping', () => {
  test('completed turn exits 0', () => {
    expect(outcomeExitCode({ durationMs: 12, outcome: 'completed' })).toBe(EXIT_OK)
  })

  test('a question exits 10 so a driver can branch on "worker is blocked"', () => {
    const outcome: RunOutcome = {
      durationMs: 3,
      kind: 'permission',
      options: ['yes', 'no'],
      outcome: 'question',
      question: 'allow write?',
    }
    expect(outcomeExitCode(outcome)).toBe(EXIT_QUESTION)
  })

  test('a dead/errored tab exits 3', () => {
    expect(outcomeExitCode({ durationMs: 1, error: 'exit 1', outcome: 'error' })).toBe(EXIT_RUNTIME)
  })

  test('hitting the overall cap exits 124', () => {
    expect(outcomeExitCode({ durationMs: 900_000, outcome: 'timeout' })).toBe(EXIT_TIMEOUT)
  })
})

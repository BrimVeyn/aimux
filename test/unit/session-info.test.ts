import { describe, expect, test } from 'bun:test'

import { parseSessionArgs } from '../../src/daemon/session-info'
import {
  consumeSessionLine,
  emptySessionUsage,
} from '../../src/services/usage-history/session-usage'

/**
 * The session id and the model are in the argv the daemon already keeps;
 * this is what reads them back. Usage is the transcript, cumulative.
 */
describe('parseSessionArgs', () => {
  test('finds the id aimux injected, in either spelling', () => {
    const id = '0e9b2d8a-1c5f-4a7e-9b3d-2f6c8e1a4b5d'
    expect(parseSessionArgs(`claude --session-id ${id} --model opus`)).toEqual({
      model: 'opus',
      sessionId: id,
    })
    expect(parseSessionArgs(`claude --resume=${id}`).sessionId).toBe(id)
    expect(parseSessionArgs('claude -r notauuid')).toEqual({ model: null, sessionId: null })
  })

  test('a shell tab has neither', () => {
    expect(parseSessionArgs('/bin/zsh')).toEqual({ model: null, sessionId: null })
  })
})

describe('consumeSessionLine', () => {
  test('sums billed messages once each, per model', () => {
    const totals = emptySessionUsage()
    const seen = new Set<string>()
    const line = (id: string, model: string, output: number): string =>
      JSON.stringify({
        message: { id, model, usage: { input_tokens: 10, output_tokens: output } },
        requestId: `req-${id}`,
        timestamp: '2026-09-03T10:00:00.000Z',
      })
    consumeSessionLine(line('m1', 'claude-opus-5', 5), seen, totals)
    consumeSessionLine(line('m1', 'claude-opus-5', 5), seen, totals)
    consumeSessionLine(line('m2', 'claude-sonnet-5', 7), seen, totals)
    consumeSessionLine('not json', seen, totals)
    expect(totals.turns).toBe(2)
    expect(totals.input).toBe(20)
    expect(totals.output).toBe(12)
    expect(totals.models).toEqual({ 'claude-opus-5': 15, 'claude-sonnet-5': 17 })
    expect(totals.lastAt).toBe('2026-09-03T10:00:00.000Z')
  })
})

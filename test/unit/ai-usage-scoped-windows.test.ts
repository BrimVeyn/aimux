import { describe, expect, it } from 'bun:test'

import { scopedWindows } from '../../src/services/ai-usage/adapters/claude'

/**
 * Fable has no `seven_day_fable` key in the OAuth usage response — it only
 * exists as a `weekly_scoped` row in `limits`, so that row is the only thing
 * standing between the model and a missing bar.
 */
describe('scopedWindows', () => {
  const now = Date.parse('2026-09-04T12:00:00Z')

  it('turns a scoped weekly limit into a window named after the model', () => {
    const windows = scopedWindows(
      [
        { kind: 'session', percent: 13 },
        { kind: 'weekly_all', percent: 13 },
        {
          kind: 'weekly_scoped',
          percent: 2,
          resets_at: '2026-09-09T21:00:00Z',
          scope: { model: { display_name: 'Fable' } },
        },
      ],
      now
    )

    expect(windows).toHaveLength(1)
    expect(windows[0]?.kind).toBe('fable')
    expect(windows[0]?.label).toBe('Fable')
    expect(windows[0]?.percent).toBe(2)
  })

  it('skips rows with no model to name', () => {
    expect(scopedWindows([{ kind: 'weekly_scoped', percent: 5, scope: null }], now)).toEqual([])
    expect(scopedWindows(undefined, now)).toEqual([])
  })
})

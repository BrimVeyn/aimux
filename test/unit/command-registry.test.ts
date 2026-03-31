import { describe, expect, test } from 'bun:test'

import { ASSISTANT_OPTIONS, getAssistantOption } from '../../src/pty/command-registry'

describe('command registry', () => {
  test('exposes the expected assistants', () => {
    expect(ASSISTANT_OPTIONS.map((option) => option.id)).toEqual([
      'claude',
      'codex',
      'opencode',
      'terminal',
    ])
  })

  test('falls back to the first assistant for out-of-range indexes', () => {
    expect(getAssistantOption(99).id).toBe('claude')
  })
})

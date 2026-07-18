import { describe, expect, test } from 'bun:test'

import {
  ASSISTANT_OPTIONS,
  buildAssistantModelArgs,
  getAssistantOption,
} from '../../src/pty/command-registry'

function option(id: string) {
  const found = ASSISTANT_OPTIONS.find((o) => o.id === id)
  if (!found) throw new Error(`no assistant ${id}`)
  return found
}

describe('command registry', () => {
  test('exposes the expected assistants', () => {
    expect(ASSISTANT_OPTIONS.map((o) => o.id)).toEqual([
      'claude',
      'codex',
      'opencode',
      'grok',
      'kimi',
      'antigravity',
      'terminal',
    ])
  })

  test('falls back to the first assistant for out-of-range indexes', () => {
    expect(getAssistantOption(99).id).toBe('claude')
  })
})

describe('buildAssistantModelArgs', () => {
  test('claude maps model + effort to native flags', () => {
    expect(buildAssistantModelArgs(option('claude'), { effort: 'high', model: 'opus' })).toEqual([
      '--model',
      'opus',
      '--effort',
      'high',
    ])
  })

  test('codex maps effort to a config override', () => {
    expect(
      buildAssistantModelArgs(option('codex'), { effort: 'high', model: 'gpt-5-codex' })
    ).toEqual(['--model', 'gpt-5-codex', '-c', 'model_reasoning_effort=high'])
  })

  test('empty selection yields no args', () => {
    expect(buildAssistantModelArgs(option('claude'), {})).toEqual([])
    expect(buildAssistantModelArgs(option('claude'), { effort: '', model: '' })).toEqual([])
  })

  test('opencode supports --model but rejects --effort', () => {
    expect(buildAssistantModelArgs(option('opencode'), { model: 'anthropic/claude-opus' })).toEqual(
      ['--model', 'anthropic/claude-opus']
    )
    expect(() => buildAssistantModelArgs(option('opencode'), { effort: 'high' })).toThrow(
      'does not support --effort'
    )
  })

  test('grok maps model to -m and effort to --effort', () => {
    expect(buildAssistantModelArgs(option('grok'), { effort: 'high', model: 'grok-4.5' })).toEqual([
      '-m',
      'grok-4.5',
      '--effort',
      'high',
    ])
    expect(buildAssistantModelArgs(option('grok'), { model: 'custom' })).toEqual(['-m', 'custom'])
  })

  test('kimi supports --model but rejects --effort', () => {
    expect(buildAssistantModelArgs(option('kimi'), { model: 'kimi-code/kimi-for-coding' })).toEqual(
      ['--model', 'kimi-code/kimi-for-coding']
    )
    expect(() => buildAssistantModelArgs(option('kimi'), { effort: 'high' })).toThrow(
      'does not support --effort'
    )
  })

  test('terminal rejects both model and effort', () => {
    expect(() => buildAssistantModelArgs(option('terminal'), { model: 'x' })).toThrow(
      'does not support --model'
    )
    expect(() => buildAssistantModelArgs(option('terminal'), { effort: 'high' })).toThrow(
      'does not support --effort'
    )
  })
})

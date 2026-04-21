import { expect, test } from 'bun:test'

import {
  buildHeadlessInvocation,
  isSupportedProvider,
} from '../../src/auto-commit/headless-commands'

test('claude with model', () => {
  const out = buildHeadlessInvocation('claude', 'go!', 'claude-haiku-4-5')
  expect(out).toEqual({
    args: ['-p', '--output-format', 'text', '--model', 'claude-haiku-4-5', 'go!'],
    executable: 'claude',
  })
})

test('claude without model omits --model flag', () => {
  const out = buildHeadlessInvocation('claude', 'go!', undefined)
  expect(out).toEqual({
    args: ['-p', '--output-format', 'text', 'go!'],
    executable: 'claude',
  })
})

test('codex with model', () => {
  const out = buildHeadlessInvocation('codex', 'go!', 'gpt-5-mini')
  expect(out).toEqual({ args: ['exec', '--model', 'gpt-5-mini', 'go!'], executable: 'codex' })
})

test('codex without model', () => {
  const out = buildHeadlessInvocation('codex', 'go!', undefined)
  expect(out).toEqual({ args: ['exec', 'go!'], executable: 'codex' })
})

test('opencode ignores model (backend decides)', () => {
  const out = buildHeadlessInvocation('opencode', 'go!', 'ignored')
  expect(out).toEqual({ args: ['run', 'go!'], executable: 'opencode' })
})

test('terminal is not supported', () => {
  expect(buildHeadlessInvocation('terminal', 'go!', undefined)).toBeNull()
})

test('isSupportedProvider identifies the three CLIs', () => {
  expect(isSupportedProvider('claude')).toBe(true)
  expect(isSupportedProvider('codex')).toBe(true)
  expect(isSupportedProvider('opencode')).toBe(true)
  expect(isSupportedProvider('terminal')).toBe(false)
  expect(isSupportedProvider('some-custom')).toBe(false)
})

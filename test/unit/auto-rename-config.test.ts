import { expect, test } from 'bun:test'

import { DEFAULT_AUTO_RENAME_CONFIG } from '../../packages/aimux-config/src/defaults'
import { defineConfig } from '../../packages/aimux-config/src/define-config'
import { resolveConfig } from '../../packages/aimux-config/src/resolver'

test('autoRename is enabled by default with cheap models', () => {
  expect(resolveConfig(defineConfig({})).autoRename).toEqual(DEFAULT_AUTO_RENAME_CONFIG)
})

test('autoRename can be disabled and partially overridden', () => {
  const value = resolveConfig(
    defineConfig({ autoRename: { enabled: false, models: { claude: 'custom' }, timeoutMs: 42 } })
  ).autoRename
  expect(value.enabled).toBe(false)
  expect(value.models.claude).toBe('custom')
  expect(value.models.codex).toBe('gpt-5-mini')
  expect(value.timeoutMs).toBe(42)
  expect(value.settleMs).toBe(DEFAULT_AUTO_RENAME_CONFIG.settleMs)
  expect(value.maxAttempts).toBe(DEFAULT_AUTO_RENAME_CONFIG.maxAttempts)
})

test('autoRename timing and retry knobs are clamped to usable values', () => {
  const value = resolveConfig(
    defineConfig({ autoRename: { maxAttempts: 0, minPromptWords: 0, settleMs: -1 } })
  ).autoRename
  expect(value.settleMs).toBe(0)
  expect(value.maxAttempts).toBe(1)
  expect(value.minPromptWords).toBe(1)
})

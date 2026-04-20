import { expect, test } from 'bun:test'

import { DEFAULT_AUTO_COMMIT_CONFIG } from '../../packages/aimux-config/src/defaults'
import { defineConfig } from '../../packages/aimux-config/src/define-config'
import { resolveConfig } from '../../packages/aimux-config/src/resolver'

test('autoCommit default is opt-in (disabled) with cheap models', () => {
  const resolved = resolveConfig(defineConfig({}))
  expect(resolved.autoCommit).toEqual(DEFAULT_AUTO_COMMIT_CONFIG)
  expect(resolved.autoCommit.enabled).toBe(false)
  expect(resolved.autoCommit.models.claude).toBe('claude-haiku-4-5')
  expect(resolved.autoCommit.models.codex).toBe('gpt-5-mini')
})

test('user can enable autoCommit', () => {
  const resolved = resolveConfig(defineConfig({ autoCommit: { enabled: true } }))
  expect(resolved.autoCommit.enabled).toBe(true)
  expect(resolved.autoCommit.timeoutMs).toBe(DEFAULT_AUTO_COMMIT_CONFIG.timeoutMs)
})

test('user can override the claude model', () => {
  const resolved = resolveConfig(
    defineConfig({ autoCommit: { models: { claude: 'claude-sonnet-4-6' } } })
  )
  expect(resolved.autoCommit.models.claude).toBe('claude-sonnet-4-6')
  expect(resolved.autoCommit.models.codex).toBe('gpt-5-mini')
})

test('user can override the timeout', () => {
  const resolved = resolveConfig(defineConfig({ autoCommit: { timeoutMs: 30_000 } }))
  expect(resolved.autoCommit.timeoutMs).toBe(30_000)
})

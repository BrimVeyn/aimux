import { expect, test } from 'bun:test'

import {
  generateTabTitle,
  generateWorkspaceNaming,
  sanitizeGeneratedBranch,
  sanitizeGeneratedTitle,
} from '../../src/auto-rename/title-runner'

test('sanitizes a concise generated title', () => {
  expect(sanitizeGeneratedTitle('TITLE: "Corriger le cache utilisateur."\nextra')).toBe(
    'Corriger le cache utilisateur'
  )
})

test('limits generated titles to six words and 48 characters', () => {
  const title = sanitizeGeneratedTitle(
    'Une correction vraiment beaucoup trop longue pour le petit titre de cet onglet'
  )
  expect(title?.split(' ').length).toBeLessThanOrEqual(6)
  expect(title?.length).toBeLessThanOrEqual(48)
})

test('rejects malformed one-word output', () => {
  expect(sanitizeGeneratedTitle('Fix')).toBeNull()
})

test('accepts concise titles in scripts that do not separate words with spaces', () => {
  expect(sanitizeGeneratedTitle('キャッシュ修正')).toBe('キャッシュ修正')
})

test('sanitizes a generated branch through the wrappers a model adds anyway', () => {
  expect(sanitizeGeneratedBranch('2. `Fix/Scroll Drift On Resize.`')).toBe(
    'fix/scroll-drift-on-resize'
  )
})

test('keeps generated branch subjects to whole words', () => {
  expect(sanitizeGeneratedBranch('feat/one-two-three-four-five-six-seven')).toBe(
    'feat/one-two-three-four-five'
  )
})

test('folds accents in a generated branch instead of cutting words at them', () => {
  expect(sanitizeGeneratedBranch('fix/améliorer-le-naming')).toBe('fix/ameliorer-le-naming')
})

test('refuses a branch outside the conventional types', () => {
  expect(sanitizeGeneratedBranch('scroll drift fix')).toBeNull()
  expect(sanitizeGeneratedBranch('wip/scroll-drift')).toBeNull()
  expect(sanitizeGeneratedBranch('fix/')).toBeNull()
})

test('workspace naming reads the title and the branch from one call', async () => {
  let calls = 0
  const result = await generateWorkspaceNaming({
    firstPrompt: 'corrige le décalage du scroll',
    provider: 'claude',
    signal: new AbortController().signal,
    spawn: async () => {
      calls++
      return { exitCode: 0, stdout: 'Corriger le décalage du scroll\nfix/scroll-drift-on-resize\n' }
    },
    timeoutMs: 1_000,
  })
  expect(result).toEqual({
    branch: 'fix/scroll-drift-on-resize',
    status: 'ok',
    title: 'Corriger le décalage du scroll',
  })
  expect(calls).toBe(1)
})

test('workspace naming keeps the title when only the branch is unusable', async () => {
  const result = await generateWorkspaceNaming({
    firstPrompt: 'fix the scroll drift',
    provider: 'claude',
    signal: new AbortController().signal,
    spawn: async () => ({ exitCode: 0, stdout: 'Fix scroll drift' }),
    timeoutMs: 1_000,
  })
  expect(result).toEqual({ branch: null, status: 'ok', title: 'Fix scroll drift' })
})

test('runs the matching provider and model', async () => {
  const calls: { executable: string; args: string[] }[] = []
  const result = await generateTabTitle({
    firstPrompt: 'Corrige le cache',
    model: 'claude-haiku-4-5',
    provider: 'claude',
    signal: new AbortController().signal,
    spawn: async (invocation) => {
      calls.push(invocation)
      return { exitCode: 0, stdout: 'Corriger le cache' }
    },
    timeoutMs: 1_000,
  })
  expect(result).toEqual({ status: 'ok', title: 'Corriger le cache' })
  expect(calls[0]?.executable).toBe('claude')
  expect(calls[0]?.args).toContain('claude-haiku-4-5')
})

test('reports a provider failure as retryable', async () => {
  const result = await generateTabTitle({
    firstPrompt: 'Fix the cache',
    provider: 'codex',
    signal: new AbortController().signal,
    spawn: async () => ({ exitCode: 1, stdout: '' }),
    timeoutMs: 1_000,
  })
  expect(result).toEqual({ status: 'failed' })
})

test('reports unusable output as retryable', async () => {
  const result = await generateTabTitle({
    firstPrompt: 'Fix the cache',
    provider: 'codex',
    signal: new AbortController().signal,
    spawn: async () => ({ exitCode: 0, stdout: 'Fix' }),
    timeoutMs: 1_000,
  })
  expect(result).toEqual({ status: 'failed' })
})

test('reports a provider without a headless mode as unavailable', async () => {
  const result = await generateTabTitle({
    firstPrompt: 'Fix the cache',
    provider: 'terminal',
    signal: new AbortController().signal,
    spawn: async () => ({ exitCode: 0, stdout: 'Corriger le cache' }),
    timeoutMs: 1_000,
  })
  expect(result).toEqual({ status: 'unavailable' })
})

test('reports a missing CLI as unavailable without spawning', async () => {
  let spawned = false
  const result = await generateTabTitle({
    firstPrompt: 'Fix the cache',
    isExecutableAvailable: () => false,
    provider: 'claude',
    signal: new AbortController().signal,
    spawn: async () => {
      spawned = true
      return { exitCode: 0, stdout: 'Corriger le cache' }
    },
    timeoutMs: 1_000,
  })
  expect(result).toEqual({ status: 'unavailable' })
  expect(spawned).toBe(false)
})

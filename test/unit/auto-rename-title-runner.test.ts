import { expect, test } from 'bun:test'

import { generateTabTitle, sanitizeGeneratedTitle } from '../../src/auto-rename/title-runner'

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

test('runs the matching provider and model', async () => {
  const calls: { executable: string; args: string[] }[] = []
  const title = await generateTabTitle({
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
  expect(title).toBe('Corriger le cache')
  expect(calls[0]?.executable).toBe('claude')
  expect(calls[0]?.args).toContain('claude-haiku-4-5')
})

test('keeps the current title on provider failure', async () => {
  const title = await generateTabTitle({
    firstPrompt: 'Fix the cache',
    provider: 'codex',
    signal: new AbortController().signal,
    spawn: async () => ({ exitCode: 1, stdout: '' }),
    timeoutMs: 1_000,
  })
  expect(title).toBeNull()
})

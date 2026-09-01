import { expect, test } from 'bun:test'

import { classifyPrompt } from '../../src/auto-rename/prompt-gate'

const gate = (prompt: string) => classifyPrompt(prompt, 3)

test('skips dialog answers and menu picks', () => {
  for (const prompt of ['', '   ', 'y', 'Yes', 'no.', 'ok', '1', '12', 'continue', 'vas-y']) {
    expect(gate(prompt)).toBe('skip')
  }
})

test('skips slash commands, shell escapes and memory notes', () => {
  for (const prompt of ['/model', '/init', '/clear opus', '!ls -la', '# remember this rule']) {
    expect(gate(prompt)).toBe('skip')
  }
})

test('treats an absolute path as a real prompt, not a slash command', () => {
  expect(gate('/home/me/app/src/index.ts is broken')).toBe('title-worthy')
})

test('skips prompts shorter than the configured word floor', () => {
  expect(gate('fix it')).toBe('skip')
  expect(gate('fix the cache')).toBe('title-worthy')
  expect(classifyPrompt('fix it', 2)).toBe('title-worthy')
})

test('uses a character floor for scripts without word spacing', () => {
  expect(gate('キャッシュを修正して')).toBe('title-worthy')
  expect(gate('はい')).toBe('skip')
})

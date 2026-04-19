import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  composePromptFromTemplate,
  loadBriefingTemplate,
} from '../../src/auto-commit/prompt-loader'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aimux-ac-prompt-'))
})

afterEach(() => {
  rmSync(dir, { force: true, recursive: true })
})

test('loadBriefingTemplate returns profile override when present', async () => {
  writeFileSync(join(dir, 'auto-commit-prompt.md'), 'PROFILE OVERRIDE')
  const out = await loadBriefingTemplate({ profileConfigRoot: dir })
  expect(out).toBe('PROFILE OVERRIDE')
})

test('loadBriefingTemplate falls back to shipped default when override missing', async () => {
  const out = await loadBriefingTemplate({ profileConfigRoot: dir })
  expect(out).toContain('TITLE:')
  expect(out).toContain('BODY:')
  expect(out).toContain('{recentCommits}')
  expect(out).toContain('{diff}')
})

test('composePromptFromTemplate substitutes placeholders', () => {
  const tpl = 'commits: {recentCommits}\n---\ndiff: {diff}'
  const out = composePromptFromTemplate(tpl, { diff: 'dd', recentCommits: 'abc one' })
  expect(out).toBe('commits: abc one\n---\ndiff: dd')
})

test('composePromptFromTemplate leaves unknown placeholders untouched', () => {
  expect(
    composePromptFromTemplate('hi {unknown} and {diff}', { diff: 'd', recentCommits: 'r' })
  ).toBe('hi {unknown} and d')
})

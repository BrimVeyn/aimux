import { $ } from 'bun'
import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AppAction } from '../../src/state/actions'
import type { AppState, GitRefreshPayload } from '../../src/state/types'

import { onManualTrigger } from '../../src/app-runtime/auto-commit-driver'
import {
  clearCommitMessageProvider,
  registerCommitMessageProvider,
} from '../../src/git/commit-message-provider'
import { createInitialState } from '../../src/state/store'

/**
 * The slot, from the driver's side.
 *
 * What matters here and nowhere else: with a plugin answering, aimux must not
 * gate the run on the headless model it would otherwise have called. A machine
 * with no `claude` in PATH is exactly where a plugin providing commit messages
 * is most useful, and the old code refused before it ever asked.
 *
 * The assistant below is deliberately one aimux has no headless invocation for.
 * With `claude` the fallback path spawns the real thing — which the first draft
 * of this file did, taking five seconds and burning credits to assert nothing.
 * Here, declining lands on "aimux has nothing either", which is the branch worth
 * pinning: the plugin is asked, and its answer decides.
 */

/** No headless invocation exists for this one, so nothing is ever spawned. */
const NO_HEADLESS_ASSISTANT = 'shell' as Parameters<typeof onManualTrigger>[1]['assistant']

const DIRTY: GitRefreshPayload = {
  ahead: 0,
  behind: 0,
  branch: 'main',
  files: [{ added: 1, path: 'a.txt', removed: 0, section: 'unstaged', status: 'M' }],
}

let repo = ''

async function makeRepo(): Promise<string> {
  repo = mkdtempSync(join(tmpdir(), 'aimux-commit-provider-'))
  await $`git init -b main ${repo}`.quiet()
  await $`git -C ${repo} config user.email t@e.st`.quiet()
  await $`git -C ${repo} config user.name Test`.quiet()
  writeFileSync(join(repo, 'a.txt'), 'one\n', 'utf8')
  await $`git -C ${repo} add .`.quiet()
  await $`git -C ${repo} commit -m first`.quiet()
  // The change the commit message will be about.
  writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n', 'utf8')
  return repo
}

function deps(dispatched: AppAction[]): Parameters<typeof onManualTrigger>[0] {
  const state: AppState = createInitialState()
  return {
    dispatch: (action) => dispatched.push(action),
    getConfig: () => ({ enabled: true, models: {}, timeoutMs: 5_000 }),
    getProfileConfigRoot: () => repo,
    getState: () => state,
  }
}

afterEach(() => {
  clearCommitMessageProvider()
  if (repo !== '') rmSync(repo, { force: true, recursive: true })
  repo = ''
})

test('a plugin writes the message, and no headless model is required', async () => {
  const root = await makeRepo()
  const seen: { branch: string; files: number; diff: boolean }[] = []
  registerCommitMessageProvider('acme.commits', (request) => {
    seen.push({
      branch: request.branch,
      diff: request.diff.includes('two'),
      files: request.files.length,
    })
    return { body: 'because the test said so', title: 'chore: written by a plugin' }
  })

  const dispatched: AppAction[] = []
  await onManualTrigger(deps(dispatched), {
    assistant: NO_HEADLESS_ASSISTANT,
    git: DIRTY,
    projectId: 'p1',
    projectPath: root,
    tabId: 't1',
  })

  // It was asked with the real working tree, not a placeholder.
  expect(seen).toHaveLength(1)
  expect(seen[0]?.branch).toBe('main')
  expect(seen[0]?.diff).toBe(true)
  expect(seen[0]?.files).toBe(1)

  const ready = dispatched.find((action) => action.type === 'auto-commit-generation-ready')
  expect(ready).toMatchObject({
    body: 'because the test said so',
    title: 'chore: written by a plugin',
  })
})

test('a provider that declines hands the question back to aimux', async () => {
  const root = await makeRepo()
  let asked = 0
  registerCommitMessageProvider('acme.commits', () => {
    asked += 1
    return null
  })

  const dispatched: AppAction[] = []
  await onManualTrigger(deps(dispatched), {
    assistant: NO_HEADLESS_ASSISTANT,
    git: DIRTY,
    projectId: 'p1',
    projectPath: root,
    tabId: 't1',
  })

  expect(asked).toBe(1)
  // Declining is not failing: aimux went on to its own path, which here has
  // nothing to offer either — so the run clears instead of committing the
  // plugin's silence as an answer.
  expect(dispatched.some((action) => action.type === 'auto-commit-generation-started')).toBe(true)
  expect(dispatched.some((action) => action.type === 'auto-commit-clear')).toBe(true)
  expect(dispatched.some((action) => action.type === 'auto-commit-generation-ready')).toBe(false)
})

test('a provider that throws costs one message, not the feature', async () => {
  const root = await makeRepo()
  registerCommitMessageProvider('acme.commits', () => {
    throw new Error('boom')
  })

  const dispatched: AppAction[] = []
  await onManualTrigger(deps(dispatched), {
    assistant: NO_HEADLESS_ASSISTANT,
    git: DIRTY,
    projectId: 'p1',
    projectPath: root,
    tabId: 't1',
  })

  // Same shape as declining: the throw is logged against the plugin, and aimux
  // carries on rather than the whole feature going down with it.
  expect(dispatched.some((action) => action.type === 'auto-commit-generation-started')).toBe(true)
  expect(dispatched.some((action) => action.type === 'auto-commit-generation-ready')).toBe(false)
})

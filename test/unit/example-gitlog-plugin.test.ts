import { type KeyResult, pluginAction, pluginActionNames } from '@brimveyn/aimux-config'
import { createTestContext, type PluginContext, type UiPluginContext } from '@brimveyn/aimux-plugin'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { SideEffectContext } from '../../src/app-runtime/side-effect-context'

import gitlogDaemon from '../../examples/plugins/gitlog/src/daemon'
import {
  type Commit,
  type Failure,
  type LogResult,
  parseLog,
  relative,
} from '../../examples/plugins/gitlog/src/parse'
import gitlogUi from '../../examples/plugins/gitlog/src/ui'
import { runPluginEffect } from '../../src/app-runtime/plugin-effects'
import { deriveModeId } from '../../src/input/modes/bridge'
import { appStore } from '../../src/state/app-store'
import { setActiveDispatch } from '../../src/state/dispatch-ref'
import { appReducer, createInitialState } from '../../src/state/store'
import { extendUiPluginContext } from '../../src/ui/plugin-ui-services'

/**
 * The example that reads a repository, checked on both sides: the parse that
 * turns git's bytes into rows, and the daemon half against a real repository —
 * because the part worth testing is the argv, and a fixture string would test
 * the format constant against itself.
 */

const FIELD = '\u001f'
const RECORD = '\u001e'

const repos: string[] = []

afterEach(() => {
  while (repos.length > 0) rmSync(repos.pop() as string, { force: true, recursive: true })
})

async function run(argv: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(argv, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_AUTHOR_NAME: 'Test Author',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test Author',
    },
    stderr: 'ignore',
    stdout: 'ignore',
  })
  expect(await proc.exited).toBe(0)
}

/** A repository with two commits, the second one touching a file. */
async function repo(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'aimux-gitlog-'))
  repos.push(root)
  await run(['git', 'init', '--initial-branch=trunk'], root)
  await Bun.write(join(root, 'a.txt'), 'one\n')
  await run(['git', 'add', 'a.txt'], root)
  await run(['git', 'commit', '-m', 'first | with a pipe'], root)
  await Bun.write(join(root, 'a.txt'), 'two\n')
  await run(['git', 'commit', '-am', 'second'], root)
  return root
}

/** The daemon half's context, with the one host service it reads. */
function daemonContext(root: string, config: Record<string, unknown> = {}) {
  return createTestContext({
    config,
    extend: (ctx: PluginContext) => {
      Object.assign(ctx, {
        projects: {
          get: (projectId: string) =>
            projectId === 'p1'
              ? {
                  activeWorkspaceId: 'w1',
                  id: 'p1',
                  name: 'test',
                  workspaces: [{ id: 'w1', name: 'main', path: root, repoRoot: root }],
                }
              : undefined,
          list: () => [],
        },
      })
    },
    host: 'daemon',
    id: 'aimux-examples.gitlog',
  })
}

describe('parseLog', () => {
  test('a subject keeps its pipes and its spacing', () => {
    const stdout = [
      ['abc1234def', 'abc1234', 'Bryan', '2026-09-07T18:12:04+02:00', 'fix(a | b): thing'].join(
        FIELD
      ),
      [
        '0009999aaa',
        '0009999',
        'Someone',
        '2026-09-01T09:00:00+02:00',
        'Merge pull request #704',
      ].join(FIELD),
    ].join(`${RECORD}\n`)

    const commits: Commit[] = parseLog(`${stdout}${RECORD}`)

    expect(commits).toHaveLength(2)
    expect(commits[0]).toEqual({
      author: 'Bryan',
      date: '2026-09-07T18:12:04+02:00',
      sha: 'abc1234def',
      short: 'abc1234',
      subject: 'fix(a | b): thing',
    })
    expect(commits[1]?.subject).toBe('Merge pull request #704')
  })

  test('an empty log is no rows, not one empty one', () => {
    expect(parseLog('')).toEqual([])
  })
})

describe('relative', () => {
  const now = Date.parse('2026-09-09T12:00:00Z')

  test('reads as a person would say it', () => {
    expect(relative('2026-09-09T11:59:30Z', now)).toBe('now')
    expect(relative('2026-09-09T11:30:00Z', now)).toBe('30 min')
    expect(relative('2026-09-07T12:00:00Z', now)).toBe('2 d')
    expect(relative('2025-09-09T12:00:00Z', now)).toBe('1 y')
  })

  test('a date git did not give reads as nothing', () => {
    expect(relative('')).toBe('')
  })
})

describe('the gitlog daemon half', () => {
  test('it reads the log of the active workspace', async () => {
    const root = await repo()
    const handle = daemonContext(root)
    await handle.apply(gitlogDaemon)

    const answer = await handle.invoke<Failure | LogResult>('log', { projectId: 'p1' })

    expect(answer).not.toHaveProperty('error')
    const result = answer as LogResult
    expect(result.branch).toBe('trunk')
    expect(result.repoRoot).toBe(root)
    expect(result.commits.map((commit) => commit.subject)).toEqual([
      'second',
      'first | with a pipe',
    ])
    expect(result.commits[0]?.author).toBe('Test Author')

    await handle.dispose()
    expect(handle.effectCount()).toBe(0)
  })

  test('a project it does not know is an error the view can draw', async () => {
    const root = await repo()
    const handle = daemonContext(root)
    await handle.apply(gitlogDaemon)

    expect(await handle.invoke<Failure>('log', { projectId: 'nope' })).toEqual({
      error: 'no project open — nothing to read a log from',
    })
    expect(await handle.invoke<Failure>('show', { projectId: 'p1', sha: 'HEAD~1' })).toEqual({
      error: 'not a commit id',
    })

    await handle.dispose()
  })

  test('`show` answers with the files, never the hunks', async () => {
    const root = await repo()
    const handle = daemonContext(root)
    await handle.apply(gitlogDaemon)

    const head = (await handle.invoke<LogResult>('log', { projectId: 'p1' })).commits[0]?.sha ?? ''
    const stat = await handle.invoke<{ text: string }>('show', { projectId: 'p1', sha: head })

    // One line per file, with git's own bar; the hunks belong to git mode.
    expect(stat.text).toContain('a.txt')
    expect(stat.text).toContain('1 file changed')
    expect(stat.text).not.toContain('+two')
    expect(stat.text).not.toContain('@@')

    await handle.dispose()
  })
})

describe('the gitlog ui half', () => {
  test('it registers the view and every key the manifest binds', async () => {
    const handle = createTestContext({ host: 'ui', id: 'aimux-examples.gitlog' })
    await handle.apply(gitlogUi)

    expect(handle.ui?.registrations.views).toEqual(['log'])
    expect(handle.ui?.registrations.actions.sort()).toEqual([
      'close',
      'detailDown',
      'detailUp',
      'down',
      'inspect',
      'open',
      'refresh',
      'up',
    ])

    await handle.dispose()
    expect(handle.effectCount()).toBe(0)
  })
})

describe('the enter key', () => {
  test('it hands the selected commit to aimux git mode', async () => {
    const handle = createTestContext({
      extend: extendUiPluginContext,
      host: 'ui',
      id: 'aimux-examples.gitlog',
    })
    await handle.apply(gitlogUi)
    // The plugin store is aimux's store: without the app's dispatcher wired,
    // every dispatch is dropped and the slice stays undefined.
    setActiveDispatch(appStore.getState().dispatch)

    // Three commits loaded, the cursor one below HEAD.
    const ctx = handle.ctx as UiPluginContext
    ctx.store.dispatch('loaded', {
      branch: 'trunk',
      commits: ['a', 'b', 'c'].map((short) => ({
        author: 'Test',
        date: '2026-09-09T12:00:00Z',
        sha: short.repeat(40),
        short,
        subject: short,
      })),
      repoRoot: '/tmp/repo',
    })
    ctx.store.dispatch('move', 1)

    const result = pluginAction('aimux-examples.gitlog.inspect')({ state: createInitialState() })
    expect(result).not.toBeNull()

    // The actions are aimux's own, so the check is what aimux's reducer does
    // with them: the view is gone, git mode is up, and its head is parked on
    // the parent of the selected commit.
    let state = createInitialState()
    for (const action of (result as KeyResult).actions) state = appReducer(state, action)
    expect(state.focusMode).toBe('git')
    expect(state.gitMode.headOffset).toBe(2)
    // And the keyboard follows: the mode is derived from that state, so the
    // keys in front of the user are git mode's without asking for a transition.
    expect(deriveModeId(state)).toBe('git-mode')

    await handle.dispose()
    setActiveDispatch(null)
    expect(pluginActionNames()).toEqual([])
  })
})

describe('a socket that dies mid-walk', () => {
  test('the rejection reaches the log, never the process', async () => {
    const seen: unknown[] = []
    const record = (reason: unknown): void => {
      seen.push(reason)
    }
    process.on('unhandledRejection', record)

    const handle = createTestContext({
      extend: extendUiPluginContext,
      host: 'ui',
      id: 'aimux-examples.gitlog',
      // What `backend.destroy()` does to everything in flight when the user
      // switches project — the plugin asked for nothing and gets an error.
      onCall: async () => {
        await Promise.reject(new Error('Remote backend destroyed'))
      },
    })
    await handle.apply(gitlogUi)
    setActiveDispatch(appStore.getState().dispatch)

    const ctx = handle.ctx as UiPluginContext
    ctx.store.dispatch('loaded', {
      branch: 'trunk',
      commits: [
        {
          author: 'Test',
          date: '2026-09-09T12:00:00Z',
          sha: 'a'.repeat(40),
          short: 'aaaaaaa',
          subject: 'a',
        },
        {
          author: 'Test',
          date: '2026-09-09T12:00:00Z',
          sha: 'b'.repeat(40),
          short: 'bbbbbbb',
          subject: 'b',
        },
      ],
      repoRoot: '/tmp/repo',
    })

    runPluginEffect('aimux-examples.gitlog', 'down', undefined, {} as SideEffectContext)
    await new Promise((resolve) => setTimeout(resolve, 20))

    process.off('unhandledRejection', record)
    expect(seen).toEqual([])
    expect(handle.logs.at(-1)?.message).toBe('git show')

    await handle.dispose()
    setActiveDispatch(null)
  })
})

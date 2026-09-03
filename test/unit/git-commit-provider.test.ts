import { createTestContext, type PluginUiApi } from '@brimveyn/aimux-plugin'
import { afterEach, describe, expect, test } from 'bun:test'

import {
  clearCommitMessageProvider,
  getCommitMessageProvider,
  registerCommitMessageProvider,
} from '../../src/git/commit-message-provider'
import { workingTreeChange } from '../../src/git/git-poller'
import { appStore } from '../../src/state/app-store'
import { createInitialState } from '../../src/state/store'
import { extendUiPluginContext } from '../../src/ui/plugin-ui-services'

/**
 * The one decision inside git mode that has no single right answer: the words
 * of the commit.
 *
 * Git mode itself stays aimux's — a screen, a diff renderer, a command queue.
 * What is open is the sentence, so a plugin can write it from a different
 * model, a ticket number, or a house style, without any of the rest moving.
 */

function harness(): ReturnType<typeof createTestContext> {
  return createTestContext({ extend: extendUiPluginContext, host: 'ui', id: 'acme.commits' })
}

afterEach(() => {
  clearCommitMessageProvider()
  appStore.setState(createInitialState())
})

describe('the commit-message slot', () => {
  test('a plugin takes it, and an unload gives it back', async () => {
    const handle = harness()
    await handle.apply({
      apply(context) {
        const ctx = context as typeof context & { ui: PluginUiApi }
        ctx.ui.git.provideCommitMessage(() => ({ body: 'why', title: 'feat: a thing' }))
      },
    })

    const slot = getCommitMessageProvider()
    expect(slot?.pluginId).toBe('acme.commits')

    await handle.dispose()
    expect(getCommitMessageProvider()).toBeNull()
  })

  test('the second plugin is refused, and told why in its own log', async () => {
    registerCommitMessageProvider('acme.first', () => ({ title: 'first' }))

    const handle = harness()
    await handle.apply({
      apply(context) {
        const ctx = context as typeof context & { ui: PluginUiApi }
        ctx.ui.git.provideCommitMessage(() => ({ title: 'second' }))
      },
    })

    // The first one still holds it: a message that depends on load order is
    // worse than no message.
    expect(getCommitMessageProvider()?.pluginId).toBe('acme.first')
    expect(handle.logs.some((entry) => entry.level === 'warn')).toBe(true)

    // And its no-op disposer does not evict the holder.
    await handle.dispose()
    expect(getCommitMessageProvider()?.pluginId).toBe('acme.first')
  })
})

describe('ctx.ui.git.status', () => {
  test('reports the panel’s last refresh, narrowed to what a plugin needs', async () => {
    appStore.setState({
      gitPanel: {
        ahead: 2,
        behind: 0,
        branch: 'feat/x',
        error: null,
        files: [
          {
            added: 3,
            path: 'src/a.ts',
            removed: 1,
            section: 'unstaged',
            status: 'M',
          },
        ],
      },
    })

    const handle = harness()
    let seen: unknown = null
    await handle.apply({
      apply(context) {
        const ctx = context as typeof context & { ui: PluginUiApi }
        seen = ctx.ui.git.status()
      },
    })

    expect(seen).toEqual({
      ahead: 2,
      behind: 0,
      branch: 'feat/x',
      files: [{ added: 3, path: 'src/a.ts', removed: 1, section: 'unstaged', status: 'M' }],
    })
    await handle.dispose()
  })
})

describe('the bare test context', () => {
  test('records the provider and can ask it, with no aimux at all', async () => {
    const handle = createTestContext({ host: 'ui', id: 'acme.commits' })
    await handle.apply({
      apply(context) {
        const ctx = context as typeof context & { ui: PluginUiApi }
        ctx.ui.git.provideCommitMessage((request) => ({
          title: `chore: ${request.files.length} files on ${request.branch}`,
        }))
      },
    })

    expect(handle.ui?.registrations.commitMessageProvider).toBe(true)
    expect(await handle.ui?.askForCommitMessage({ branch: 'main' })).toEqual({
      title: 'chore: 0 files on main',
    })

    await handle.dispose()
    expect(handle.ui?.registrations.commitMessageProvider).toBe(false)
  })
})

describe('git:workingTreeChanged', () => {
  const payload = {
    ahead: 0,
    behind: 0,
    branch: 'main',
    files: [
      { added: 1, path: 'a.ts', removed: 0, section: 'unstaged' as const, status: 'M' as const },
    ],
  }

  test('fires when the tree moves, and stays quiet when it has not', () => {
    const first = workingTreeChange(payload, '/repo', '')
    expect(first?.event).toMatchObject({ branch: 'main', repoRoot: '/repo' })
    expect(first?.event.files).toEqual([
      { added: 1, path: 'a.ts', removed: 0, section: 'unstaged', status: 'M' },
    ])

    // The poll runs every few seconds; the same tree must not wake anyone.
    expect(workingTreeChange(payload, '/repo', first?.hash ?? '')).toBeNull()

    const changed = {
      ...payload,
      files: [
        { added: 2, path: 'a.ts', removed: 0, section: 'unstaged' as const, status: 'M' as const },
      ],
    }
    expect(workingTreeChange(changed, '/repo', first?.hash ?? '')).not.toBeNull()
  })
})

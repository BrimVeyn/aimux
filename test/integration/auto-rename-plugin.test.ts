import { resolveConfig } from '@brimveyn/aimux-config'
import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { PluginRpcTransport } from '../../src/plugins/types'

import { builtinPlugins } from '../../src/builtin-plugins'
import {
  createDaemonContextExtender,
  type DaemonPluginBackings,
  type PluginTabView,
} from '../../src/daemon/plugin-services'
import { PluginRuntime } from '../../src/plugins/loader'

/**
 * Auto-rename as a plugin.
 *
 * It is the built-in that proves the *daemon* API rather than the UI one: it
 * reacts to an event, decides, and writes a tab's title, with no privileged
 * access to any of the three. aimux kept what a tab *is*; every decision about
 * what to call it moved out.
 *
 * The assistant below has no headless invocation, so nothing is spawned and
 * the coordinator falls back to its local heuristic — which is what makes this
 * a test rather than a model call with an assertion attached.
 */

const TRANSPORT: PluginRpcTransport = { broadcast: () => {}, call: async () => null }

let runtime: PluginRuntime | null = null
let tempHome = ''

const originalHome = process.env.HOME
const originalProfile = process.env.AIMUX_PROFILE

interface Harness {
  runtime: PluginRuntime
  renames: { tabId: string; title: string }[]
  tab: { title: string; unnamed: boolean }
}

async function start(): Promise<Harness> {
  tempHome = mkdtempSync(join(tmpdir(), 'aimux-auto-rename-plugin-'))
  process.env.HOME = tempHome
  process.env.AIMUX_PROFILE = 'auto-rename-plugin-test'

  const renames: { tabId: string; title: string }[] = []
  const tab = { title: 'Shell', unnamed: true }

  const view = (): PluginTabView => ({
    assistant: 'shell',
    command: 'sh',
    id: 'tab-1',
    projectId: 'p1',
    title: tab.title,
    unnamed: tab.unnamed,
  })

  const backings = {
    activeTabId: () => 'tab-1',
    closeTab: async () => {
      /* the plugin never closes a tab */
    },
    focus: async () => {
      /* nor focuses one */
    },
    hookServer: () => null,
    renameTab: (tabId: string, title: string) => {
      renames.push({ tabId, title })
      tab.title = title
      // What the daemon does on any rename: the tab has a name now.
      tab.unnamed = false
    },
    spawnTab: async () => 'tab-2',
    tabs: () => new Map(),
    write: async () => {
      /* nor writes to the PTY */
    },
  } as unknown as DaemonPluginBackings

  const resolved = resolveConfig({ autoRename: { enabled: true, settleMs: 0 } })
  const instance = new PluginRuntime({
    builtins: builtinPlugins(resolved),
    extendContext: (ctx) => {
      createDaemonContextExtender(backings)(ctx)
      // One tab, whose state the test drives.
      const tabs = (ctx as unknown as { tabs: Record<string, unknown> }).tabs
      tabs.get = (tabId: string): PluginTabView | undefined =>
        tabId === 'tab-1' ? view() : undefined
    },
    host: 'daemon',
    transport: TRANSPORT,
    userPlugins: resolved.plugins,
  })
  runtime = instance
  await instance.start()
  return { renames, runtime: instance, tab }
}

afterEach(async () => {
  await runtime?.stop()
  runtime = null
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalProfile === undefined) delete process.env.AIMUX_PROFILE
  else process.env.AIMUX_PROFILE = originalProfile
  if (tempHome !== '') rmSync(tempHome, { force: true, recursive: true })
  tempHome = ''
})

test('a prompt names the tab, through the public API and nothing else', async () => {
  const harness = await start()
  expect(harness.runtime.statuses().map((status) => status.state)).toEqual(['active'])

  harness.runtime.kernel.emit('tab:prompt', {
    projectId: 'p1',
    prompt: 'Corrige le cache utilisateur du worker pool',
    source: 'keystrokes',
    tabId: 'tab-1',
  })
  await Bun.sleep(80)

  expect(harness.renames).toHaveLength(1)
  expect(harness.renames[0]?.tabId).toBe('tab-1')
  expect(harness.renames[0]?.title.length).toBeGreaterThan(0)
  // And the tab is no longer up for naming, which is what stops a second namer.
  expect(harness.tab.unnamed).toBe(false)
})

test('a tab someone has already named is left alone', async () => {
  const harness = await start()
  harness.tab.unnamed = false
  harness.tab.title = 'Ce que j’ai tapé moi-même'

  harness.runtime.kernel.emit('tab:prompt', {
    projectId: 'p1',
    prompt: 'Corrige le cache utilisateur du worker pool',
    source: 'keystrokes',
    tabId: 'tab-1',
  })
  await Bun.sleep(80)

  expect(harness.renames).toEqual([])
  expect(harness.tab.title).toBe('Ce que j’ai tapé moi-même')
})

test('a rename from elsewhere aborts what is in flight', async () => {
  const harness = await start()

  harness.runtime.kernel.emit('tab:prompt', {
    projectId: 'p1',
    prompt: 'Corrige le cache utilisateur du worker pool',
    source: 'keystrokes',
    tabId: 'tab-1',
  })
  // Before the settle window elapses, the user types their own title.
  harness.runtime.kernel.emit('tab:renamed', {
    projectId: 'p1',
    tabId: 'tab-1',
    title: 'Mon titre',
  })
  harness.tab.unnamed = false
  harness.tab.title = 'Mon titre'
  await Bun.sleep(80)

  expect(harness.renames).toEqual([])
  expect(harness.tab.title).toBe('Mon titre')
})

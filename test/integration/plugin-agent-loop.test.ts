import { clearPluginActions, getDefaultKeymapConfig } from '@brimveyn/aimux-config'
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { SideEffectContext } from '../../src/app-runtime/side-effect-context'
import type { PluginRpcTransport } from '../../src/plugins/types'

import { clearPluginEffects, runPluginEffect } from '../../src/app-runtime/plugin-effects'
import { setActiveKeymap } from '../../src/input/keymap/keymap-ref'
import { registerAllModes } from '../../src/input/modes/handlers'
import { PluginRuntime } from '../../src/plugins/loader'
import { upsertPluginRegistryEntry } from '../../src/plugins/registry-file'
import { appStore } from '../../src/state/app-store'
import { clearPluginWidgetIds } from '../../src/state/bars'
import { setActiveDispatch, setActiveSideEffectRunner } from '../../src/state/dispatch-ref'
import { clearPluginSlices } from '../../src/state/reducers/plugin-slices'
import { createInitialState } from '../../src/state/store'
import { describeUiState, resolveKeymap, runPluginActionByName } from '../../src/ui/introspection'
import { clearBarWidgets } from '../../src/ui/widgets/registry'

/**
 * The loop an agent runs, end to end, with nobody watching.
 *
 * This is the phase-8 acceptance test, and it is written from the outside: it
 * asserts through the same three functions `aimux ui state`,
 * `aimux keymap resolve` and `aimux action run` answer with, because those are
 * all an agent can see. A plugin arrives on disk, declares where its widget
 * goes and which key runs its action, and the test checks that it is visible,
 * reachable and reversible — with no `aimux.config.ts` edit and no restart
 * anywhere in it.
 *
 * What it does *not* cover: an agent actually writing the plugin. That half is
 * a prompt, not an assertion.
 */

const FIXTURES = join(new URL('..', import.meta.url).pathname, 'fixtures', 'plugins')
const PLUGIN_ID = 'aimux-test.gearbox'
const WIDGET = `${PLUGIN_ID}.gear`

const originalHome = process.env.HOME
const originalProfile = process.env.AIMUX_PROFILE
const originalWatch = process.env.AIMUX_PLUGIN_WATCH

const TRANSPORT: PluginRpcTransport = {
  broadcast: () => {},
  call: async () => null,
}

const keymap = getDefaultKeymapConfig()
let tempHome = ''
let runtime: PluginRuntime | null = null

async function linkAndStart(): Promise<PluginRuntime> {
  const root = join(tempHome, 'gearbox')
  cpSync(join(FIXTURES, 'gearbox'), root, { recursive: true })
  // What `aimux plugin link .` writes.
  upsertPluginRegistryEntry({ enabled: true, id: PLUGIN_ID, path: root, source: 'link' })

  const instance = new PluginRuntime({
    extendContext: (await import('../../src/ui/plugin-ui-services')).extendUiPluginContext,
    host: 'ui',
    transport: TRANSPORT,
    userPlugins: [],
  })
  runtime = instance
  await instance.start()
  return instance
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'aimux-agent-loop-'))
  mkdirSync(tempHome, { recursive: true })
  process.env.HOME = tempHome
  process.env.AIMUX_PROFILE = 'agent-loop-test'
  process.env.AIMUX_PLUGIN_WATCH = '0'

  appStore.setState(createInitialState())
  // What `app.tsx` publishes on mount: the plugin services and the
  // introspection answers both reach the app through these two refs.
  setActiveDispatch(appStore.getState().dispatch)
  setActiveSideEffectRunner((effect) => {
    if (effect.type !== 'plugin-effect') return
    // The real runner hands the effect a `SideEffectContext` built from the
    // renderer, the backend and the live state. A plugin effect that reads any
    // of that is out of scope here, so the seam gets an empty one rather than a
    // fake terminal.
    runPluginEffect(
      effect.pluginId,
      effect.effectId,
      effect.payload,
      {} as unknown as SideEffectContext
    )
  })
  setActiveKeymap(keymap)
  registerAllModes(keymap)
})

afterEach(async () => {
  await runtime?.stop()
  runtime = null
  clearBarWidgets()
  clearPluginWidgetIds()
  clearPluginSlices()
  clearPluginEffects()
  clearPluginActions()
  setActiveDispatch(null)
  setActiveSideEffectRunner(null)
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalProfile === undefined) delete process.env.AIMUX_PROFILE
  else process.env.AIMUX_PROFILE = originalProfile
  if (originalWatch === undefined) delete process.env.AIMUX_PLUGIN_WATCH
  else process.env.AIMUX_PLUGIN_WATCH = originalWatch
  rmSync(tempHome, { force: true, recursive: true })
})

test('linking is the whole setup: placed, drawable, bound, runnable, reversible', async () => {
  const instance = await linkAndStart()
  expect(instance.statuses()[0]?.state).toBe('active')

  // 1. Is it on the screen? — `aimux ui state`
  const placed = describeUiState().bars.right.widgets.find((widget) => widget.id === WIDGET)
  expect(placed).toBeDefined()
  expect(placed?.visible).toBe(true)
  // Not just listed: something can actually draw it.
  expect(placed?.renderable).toBe(true)
  expect(placed?.grow).toBe(30)
  // And it is the plugin's placement, so unloading may take it back.
  expect(placed?.placedBy).toBe('plugin')
  // A widget in a bar nobody opened is a widget nobody sees.
  expect(describeUiState().bars.right.visible).toBe(true)

  // 2. Does the key do what it claims? — `aimux keymap resolve`
  expect(resolveKeymap('<leader>+', 'navigation')).toMatchObject({
    bound: true,
    origin: 'plugin',
    pluginId: PLUGIN_ID,
  })

  // 3. Does the action work, without a keyboard? — `aimux action run`
  const report = runPluginActionByName(`${PLUGIN_ID}.up`)
  expect(report).toMatchObject({ effects: 1, ran: true })
  // The effect ran in the plugin, so its own state moved.
  await Bun.sleep(5)
  expect(await instance.kernel.handleRpc(PLUGIN_ID, 'gear', undefined)).toBe(2)

  // 4. And an unload leaves nothing of any of it behind.
  await instance.stop()
  runtime = null
  expect(describeUiState().bars.right.widgets.some((widget) => widget.id === WIDGET)).toBe(false)
  expect(resolveKeymap('<leader>+', 'navigation').bound).toBe(false)
  expect(runPluginActionByName(`${PLUGIN_ID}.up`).ran).toBe(false)
})

test('what the user arranges survives the plugin that placed it', async () => {
  const instance = await linkAndStart()

  // The user drags it to the other bar: the placement is theirs now.
  appStore.getState().dispatch({ index: 0, side: 'left', type: 'move-widget', widgetId: WIDGET })
  expect(
    describeUiState().bars.left.widgets.find((widget) => widget.id === WIDGET)?.placedBy
  ).toBeUndefined()

  await instance.stop()
  runtime = null
  // Still where they put it — an unload withdraws its own placement, never one
  // the user has taken over.
  expect(describeUiState().bars.left.widgets.some((widget) => widget.id === WIDGET)).toBe(true)
})

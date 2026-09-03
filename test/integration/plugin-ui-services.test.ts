import { clearPluginActions, pluginAction, pluginActionNames } from '@brimveyn/aimux-config'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { PluginRpcTransport } from '../../src/plugins/types'

import { clearPluginEffects, runPluginEffect } from '../../src/app-runtime/plugin-effects'
import { clearHelpModeLabels } from '../../src/input/keymap/help-entries'
import { clearModeDerivations, deriveModeId } from '../../src/input/modes/bridge'
import { clearPluginModes, isValidTransition } from '../../src/input/modes/transitions'
import { PluginRuntime } from '../../src/plugins/loader'
import { upsertPluginRegistryEntry } from '../../src/plugins/registry-file'
import { clearSettingSections } from '../../src/settings/sections'
import { appStore } from '../../src/state/app-store'
import { clearPluginWidgetIds, isWidgetRenderable } from '../../src/state/bars'
import { setActiveDispatch } from '../../src/state/dispatch-ref'
import { clearPluginSlices } from '../../src/state/reducers/plugin-slices'
import { createInitialState } from '../../src/state/store'
import { clearPluginModals, getPluginModal } from '../../src/ui/plugin-modals'
import { extendUiPluginContext } from '../../src/ui/plugin-ui-services'
import { clearPluginViews, getPluginView } from '../../src/ui/plugin-views'
import { clearBarWidgets, getWidgetLabel } from '../../src/ui/widgets/registry'

/**
 * The whole UI chain, from a plugin file on disk to a registration the app can
 * see: discovery, bundling, `apply`, the services attached by
 * `extendUiPluginContext`, and — the property everything else rests on — an
 * unload that leaves nothing behind.
 */

const FIXTURES = join(new URL('..', import.meta.url).pathname, 'fixtures', 'plugins')

const originalHome = process.env.HOME
const originalProfile = process.env.AIMUX_PROFILE
const originalWatch = process.env.AIMUX_PLUGIN_WATCH

let tempHome = ''
let runtime: PluginRuntime | null = null

const TRANSPORT: PluginRpcTransport = {
  broadcast: () => {},
  call: async () => null,
}

async function startWithFixture(): Promise<PluginRuntime> {
  const root = join(tempHome, 'ui-kit')
  cpSync(join(FIXTURES, 'ui-kit'), root, { recursive: true })
  upsertPluginRegistryEntry({ enabled: true, id: 'aimux-test.uikit', path: root, source: 'link' })

  const instance = new PluginRuntime({
    extendContext: extendUiPluginContext,
    host: 'ui',
    transport: TRANSPORT,
    userPlugins: [],
  })
  runtime = instance
  await instance.start()
  return instance
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'aimux-ui-services-'))
  mkdirSync(tempHome, { recursive: true })
  process.env.HOME = tempHome
  process.env.AIMUX_PROFILE = 'ui-services-test'
  process.env.AIMUX_PLUGIN_WATCH = '0'
  appStore.setState(createInitialState())
  // What `app.tsx` does on mount. The services dispatch the way every other
  // non-React caller does — through the global ref — so the test has to stand
  // in for the component that publishes it.
  setActiveDispatch(appStore.getState().dispatch)
})

afterEach(async () => {
  await runtime?.stop()
  runtime = null
  clearBarWidgets()
  clearPluginWidgetIds()
  clearPluginViews()
  clearPluginModals()
  clearPluginModes()
  clearModeDerivations()
  clearHelpModeLabels()
  clearSettingSections()
  clearPluginSlices()
  clearPluginEffects()
  clearPluginActions()
  setActiveDispatch(null)
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalProfile === undefined) delete process.env.AIMUX_PROFILE
  else process.env.AIMUX_PROFILE = originalProfile
  if (originalWatch === undefined) delete process.env.AIMUX_PLUGIN_WATCH
  else process.env.AIMUX_PLUGIN_WATCH = originalWatch
  rmSync(tempHome, { force: true, recursive: true })
})

describe('UI plugin services', () => {
  test('every registration lands, namespaced by plugin id', async () => {
    const instance = await startWithFixture()
    expect(instance.statuses()[0]?.state).toBe('active')

    // The plugin asked for `board`; two plugins can each have a "board", so
    // the host prefixed it and the owner stays readable from the id.
    expect(isWidgetRenderable('aimux-test.uikit.board')).toBe(true)
    expect(getWidgetLabel('aimux-test.uikit.board')).toBe('Board')
    expect(getPluginView('aimux-test.uikit.board')?.title).toBe('Board')
    expect(getPluginModal('aimux-test.uikit.confirm')?.title).toBe('Confirm')
    expect(pluginActionNames()).toEqual(['aimux-test.uikit.open'])
  })

  test('the registered view opens, claims input, and closes', async () => {
    await startWithFixture()
    const { dispatch } = appStore.getState()

    dispatch({ type: 'open-plugin-view', viewId: 'aimux-test.uikit.board' })
    expect(appStore.getState().focusMode).toBe('plugin-view')
    expect(deriveModeId(appStore.getState())).toBe('plugin.aimux-test.uikit.board')
    expect(isValidTransition('navigation', 'plugin.aimux-test.uikit.board')).toBe(true)

    dispatch({ type: 'close-plugin-view' })
    expect(deriveModeId(appStore.getState())).toBe('navigation')
  })

  test('the action produces a KeyResult whose effect reaches the slice', async () => {
    await startWithFixture()

    const result = pluginAction('aimux-test.uikit.open')({ state: appStore.getState() })
    expect(result?.effects).toEqual([
      { effectId: 'greet', pluginId: 'aimux-test.uikit', type: 'plugin-effect' },
    ])

    // Running that effect dispatches into the plugin's own slice — the full
    // action → effect → reducer round trip a keybinding takes.
    const effect = result?.effects[0]
    if (effect?.type !== 'plugin-effect') return
    runPluginEffect(effect.pluginId, effect.effectId, effect.payload, {
      state: appStore.getState(),
    } as never)
    await Bun.sleep(5)

    expect(appStore.getState().plugins['aimux-test.uikit']).toEqual({ count: 1 })
  })

  test('unloading leaves nothing behind', async () => {
    const instance = await startWithFixture()
    await instance.kernel.unload('aimux-test.uikit')

    // The plugin kept none of its disposers; the fiber did.
    expect(isWidgetRenderable('aimux-test.uikit.board')).toBe(false)
    expect(getPluginView('aimux-test.uikit.board')).toBeUndefined()
    expect(getPluginModal('aimux-test.uikit.confirm')).toBeUndefined()
    expect(pluginActionNames()).toEqual([])
    expect(isValidTransition('navigation', 'plugin.aimux-test.uikit.board')).toBe(false)
    expect(pluginAction('aimux-test.uikit.open')({ state: appStore.getState() })).toBeNull()
  })

  test('a reload registers exactly once, not twice', async () => {
    const instance = await startWithFixture()
    await instance.kernel.reload('aimux-test.uikit')

    expect(pluginActionNames()).toEqual(['aimux-test.uikit.open'])
    expect(getPluginView('aimux-test.uikit.board')?.title).toBe('Board')
    // Three registrations per apply, and the same three after a reload.
    expect(instance.statuses()[0]?.revision).toBe(2)
  })
})

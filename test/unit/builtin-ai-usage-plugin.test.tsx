import { createTestContext, type PluginUiApi } from '@brimveyn/aimux-plugin'
import { afterEach, describe, expect, mock, test } from 'bun:test'

import { aiUsagePlugin } from '../../src/builtin-plugins/ai-usage'
import { ALL_SETTING_ROWS } from '../../src/settings/sections'
import { settingsStore } from '../../src/settings/settings-store'
import { aiUsageStore } from '../../src/state/ai-usage-store'

/**
 * The second migration, and the one that needed a new surface: the status bar
 * had four fixed slots and no way to accept a tile from anywhere else.
 */

const stops: number[] = []

await mock.module('../../src/services/ai-usage/provider', () => ({
  startAIUsageService: () => ({
    refresh: () => {},
    stop: () => {
      stops.push(1)
    },
  }),
}))

const { extendUiPluginContext } = await import('../../src/ui/plugin-ui-services')
const { default: plugin } = await import('../../src/builtin-plugins/ai-usage/ui')

interface Harness {
  ui: PluginUiApi
  dispose: () => Promise<unknown>
}

async function applyPlugin(config: Record<string, unknown> = {}): Promise<Harness> {
  const handle = createTestContext({
    config,
    extend: extendUiPluginContext,
    host: 'ui',
    id: 'aimux.ai-usage',
  })
  await handle.apply(plugin)
  return {
    dispose: async () => handle.dispose(),
    ui: (handle.ctx as unknown as { ui: PluginUiApi }).ui,
  }
}

afterEach(() => {
  stops.length = 0
  settingsStore.setState({ values: {} })
  aiUsageStore.getState().setEnabled(false)
})

describe('the AI usage indicator as a plugin', () => {
  test('the settings rows it obeys are aimux own', () => {
    const ids = new Set(ALL_SETTING_ROWS.map((row) => row.id))
    expect(ids.has('statusBar.aiUsage.enabled')).toBe(true)
    expect(ids.has('statusBar.aiUsage.pollSeconds')).toBe(true)
  })

  test('config-file-only keys are seeded into ctx.config, not read from aimux', () => {
    const built = aiUsagePlugin({
      statusBar: { aiUsage: { claudePlan: 'max20', tools: ['codex'] } },
    } as Parameters<typeof aiUsagePlugin>[0])

    // No settings row exists for either, and the plugin body reads only
    // `ctx.config` — so the mapping has to live in the declaration.
    expect(built.config).toEqual({ claudePlan: 'max20', tools: ['codex'] })
    expect(built.manifest.id).toBe('aimux.ai-usage')
  })

  test('nothing runs and no tile appears while the toggle is off', async () => {
    const handle = await applyPlugin()
    expect(aiUsageStore.getState().enabled).toBe(false)
    await handle.dispose()
  })

  test('turning it on starts the service and registers the tile', async () => {
    settingsStore.setState({ values: { 'statusBar.aiUsage.enabled': true } })
    const handle = await applyPlugin()

    expect(aiUsageStore.getState().enabled).toBe(true)

    // And turning it off again stops the service and takes the tile away —
    // a segment that rendered nothing would still cost two separators.
    settingsStore.setState({ values: { 'statusBar.aiUsage.enabled': false } })
    expect(stops).toHaveLength(1)
    expect(aiUsageStore.getState().enabled).toBe(false)
    await handle.dispose()
  })

  test('unloading stops the service', async () => {
    settingsStore.setState({ values: { 'statusBar.aiUsage.enabled': true } })
    const handle = await applyPlugin()
    await handle.dispose()

    expect(stops).toHaveLength(1)
    expect(aiUsageStore.getState().enabled).toBe(false)
  })
})

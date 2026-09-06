import type { AIUsageToolConfig } from '@brimveyn/aimux-config'

import { createTestContext } from '@brimveyn/aimux-plugin'
import { afterEach, describe, expect, mock, test } from 'bun:test'

import { aiUsagePlugin } from '../../src/builtin-plugins/ai-usage'
import { ALL_SETTING_ROWS } from '../../src/settings/sections'
import { settingsStore } from '../../src/settings/settings-store'

/**
 * The second migration, and the one that needed a new surface: the status bar
 * had four fixed slots and no way to accept a tile from anywhere else.
 *
 * It also spent a release with two switches — the plugin's own and a
 * `statusBar.aiUsage.enabled` settings row it watched — so turning it on did
 * nothing. Being loaded is now the whole switch, which is what most of these
 * assertions are about.
 */

const starts: AIUsageToolConfig[] = []
const stops: number[] = []

await mock.module('../../src/services/ai-usage/provider', () => ({
  startAIUsageService: (config: AIUsageToolConfig) => {
    starts.push(config)
    return {
      refresh: () => {},
      stop: () => {
        stops.push(1)
      },
    }
  },
}))

const { extendUiPluginContext } = await import('../../src/ui/plugin-ui-services')
const { statusBarSegmentIds } = await import('../../src/ui/status-bar-segments')
const { default: plugin } = await import('../../src/builtin-plugins/ai-usage/ui')

async function applyPlugin(
  config: Record<string, unknown> = {}
): Promise<{ dispose: () => Promise<unknown> }> {
  const handle = createTestContext({
    config,
    extend: extendUiPluginContext,
    host: 'ui',
    id: 'aimux.ai-usage',
  })
  await handle.apply(plugin)
  return { dispose: async () => handle.dispose() }
}

afterEach(() => {
  starts.length = 0
  stops.length = 0
  settingsStore.setState({ values: {} })
})

describe('the AI usage indicator as a plugin', () => {
  test('the only settings row left to it is how often it asks', () => {
    const ids = new Set(ALL_SETTING_ROWS.map((row) => row.id))

    // The switch is the plugin's own. A row beside it could only disagree with
    // it, and for a release it did.
    expect(ids.has('statusBar.aiUsage.enabled')).toBe(false)
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

  test('it ships off, because it reads a keychain and two OAuth endpoints', () => {
    expect(aiUsagePlugin().defaultEnabled).toBe(false)
    // Nobody has said anything, so nothing is claimed either way.
    expect(aiUsagePlugin().enabled).toBeUndefined()
  })

  test('the config key it had before it was a plugin still switches it', () => {
    const on = aiUsagePlugin({
      statusBar: { aiUsage: { enabled: true } },
    } as Parameters<typeof aiUsagePlugin>[0])
    const off = aiUsagePlugin({
      statusBar: { aiUsage: { enabled: false } },
    } as Parameters<typeof aiUsagePlugin>[0])

    expect(on.enabled).toBe(true)
    expect(off.enabled).toBe(false)
  })

  test('applying it registers the tile and starts the service', async () => {
    const handle = await applyPlugin()

    expect(statusBarSegmentIds()).toContain('aimux.ai-usage.quota')
    expect(starts).toHaveLength(1)

    await handle.dispose()
  })

  test('a new refresh interval restarts the service, and leaves the tile alone', async () => {
    const handle = await applyPlugin()
    settingsStore.setState({ values: { 'statusBar.aiUsage.pollSeconds': 600 } })

    expect(stops).toHaveLength(1)
    expect(starts).toHaveLength(2)
    expect(starts[1]?.pollSeconds).toBe(600)
    expect(statusBarSegmentIds()).toContain('aimux.ai-usage.quota')

    await handle.dispose()
  })

  test('unloading stops the service and takes the tile away', async () => {
    const handle = await applyPlugin()
    await handle.dispose()

    expect(stops).toHaveLength(1)
    // A segment that rendered nothing would still cost a tile and two separators.
    expect(statusBarSegmentIds()).not.toContain('aimux.ai-usage.quota')
  })
})

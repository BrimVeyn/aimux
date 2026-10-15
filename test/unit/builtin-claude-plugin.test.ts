import { createTestContext } from '@brimveyn/aimux-plugin'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import claudePlugin from '../../src/builtin-plugins/claude/ui'
import { ALL_SETTING_ROWS } from '../../src/settings/sections'
import { settingsStore } from '../../src/settings/settings-store'
import { extendUiPluginContext } from '../../src/ui/plugin-ui-services'

/**
 * The first feature to become a plugin, checked through the plugin API rather
 * than through its own internals — because what is being tested is that the
 * API can carry it.
 */

const originalClaudeDir = process.env.CLAUDE_CONFIG_DIR

let tempHome = ''

function settingsFile(): string {
  return join(tempHome, 'settings.json')
}

async function applyPlugin(): Promise<{ dispose: () => Promise<unknown> }> {
  const handle = createTestContext({
    extend: extendUiPluginContext,
    host: 'ui',
    id: 'aimux.claude',
  })
  await handle.apply(claudePlugin)
  return { dispose: async () => handle.dispose() }
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'aimux-claude-'))
  process.env.CLAUDE_CONFIG_DIR = tempHome
  settingsStore.setState({ values: {} })
})

afterEach(() => {
  if (originalClaudeDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = originalClaudeDir
  settingsStore.setState({ values: {} })
  rmSync(tempHome, { force: true, recursive: true })
})

describe('the Claude integration as a plugin', () => {
  test('it watches a settings row that actually exists', () => {
    // The plugin names its row as a string, the way a third-party plugin would
    // have to. This is what keeps that string honest.
    const ids = new Set(ALL_SETTING_ROWS.map((row) => row.id))
    expect(ids.has('integrations.claudeHooks')).toBe(true)
  })

  test('writes nothing while the toggle is off', async () => {
    const handle = await applyPlugin()
    expect(existsSync(settingsFile())).toBe(false)
    await handle.dispose()
  })

  test('turning the toggle on installs the hooks without a restart', async () => {
    const handle = await applyPlugin()
    settingsStore.setState({ values: { 'integrations.claudeHooks': true } })

    const settings = JSON.parse(readFileSync(settingsFile(), 'utf8')) as { hooks?: object }
    expect(Object.keys(settings.hooks ?? {}).length).toBeGreaterThan(0)
    await handle.dispose()
  })
})

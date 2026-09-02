import { createTestContext } from '@brimveyn/aimux-plugin'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import claudePlugin from '../../src/builtin-plugins/claude/ui'
import { ALL_SETTING_ROWS } from '../../src/settings/sections'
import { settingsStore } from '../../src/settings/settings-store'
import { extendUiPluginContext } from '../../src/ui/plugin-ui-services'
import { setMode } from '../../src/ui/theme-store'

/**
 * The first feature to become a plugin, checked through the plugin API rather
 * than through its own internals — because what is being tested is that the
 * API can carry it.
 */

const originalClaudeDir = process.env.CLAUDE_CONFIG_DIR

let tempHome = ''

function themeFile(): string {
  return join(tempHome, 'themes', 'aimux.json')
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
  test('it watches settings rows that actually exist', () => {
    // The plugin names its rows as strings, the way a third-party plugin would
    // have to. This is what keeps that string honest.
    const ids = new Set(ALL_SETTING_ROWS.map((row) => row.id))
    expect(ids.has('theme.beta.harmonizeClaudeTheme')).toBe(true)
    expect(ids.has('integrations.claudeHooks')).toBe(true)
  })

  test('writes nothing while the toggle is off', async () => {
    const handle = await applyPlugin()
    expect(existsSync(themeFile())).toBe(false)
    expect(existsSync(join(tempHome, 'settings.json'))).toBe(false)
    await handle.dispose()
  })

  test('turning the toggle on writes the theme without a restart', async () => {
    const handle = await applyPlugin()
    settingsStore.setState({ values: { 'theme.beta.harmonizeClaudeTheme': true } })

    const written = JSON.parse(readFileSync(themeFile(), 'utf8')) as Record<string, unknown>
    expect(Object.keys(written).length).toBeGreaterThan(0)
    // And the preference that makes Claude pick it up.
    const settings = JSON.parse(readFileSync(join(tempHome, 'settings.json'), 'utf8')) as {
      theme?: string
    }
    expect(settings.theme).toBe('custom:aimux')
    await handle.dispose()
  })

  test('a theme change re-writes it, and an unload stops that', async () => {
    settingsStore.setState({ values: { 'theme.beta.harmonizeClaudeTheme': true } })
    const handle = await applyPlugin()

    setMode('light')
    const light = readFileSync(themeFile(), 'utf8')
    setMode('dark')
    const dark = readFileSync(themeFile(), 'utf8')
    expect(dark).not.toBe(light)

    await handle.dispose()
    setMode('light')
    // Unloading the plugin took the subscription off with it.
    expect(readFileSync(themeFile(), 'utf8')).toBe(dark)
  })
})

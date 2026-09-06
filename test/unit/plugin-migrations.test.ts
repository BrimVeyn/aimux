import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadConfig } from '../../src/config'
import { runPluginMigrations } from '../../src/plugins/migrations'
import { loadPluginRegistryResult } from '../../src/plugins/registry-file'

/**
 * The AI usage indicator had two switches — its plugin, and a
 * `statusBar.aiUsage.enabled` settings row — and dropping the row would
 * silently throw away the answer of everyone who had used it. It ships off, so
 * a `true` has to become an override or the indicator disappears on upgrade.
 */

const PROFILE = 'migrations-test'
const originalHome = process.env.HOME
const originalProfile = process.env.AIMUX_PROFILE

let tempHome = ''

function profileDir(): string {
  return join(tempHome, '.config', 'aimux', PROFILE)
}

function writeStoredSettings(settings: Record<string, unknown>): void {
  mkdirSync(profileDir(), { recursive: true })
  writeFileSync(join(profileDir(), 'aimux.json'), JSON.stringify({ settings, version: 2 }))
}

function aiUsageOverride(): boolean | undefined {
  return loadPluginRegistryResult().registry.overrides['aimux.ai-usage']?.enabled
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'aimux-migrations-'))
  process.env.HOME = tempHome
  process.env.AIMUX_PROFILE = PROFILE
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalProfile === undefined) delete process.env.AIMUX_PROFILE
  else process.env.AIMUX_PROFILE = originalProfile
  rmSync(tempHome, { force: true, recursive: true })
})

test('an indicator someone had switched on stays on, as the plugin being loaded', () => {
  writeStoredSettings({ 'statusBar.aiUsage.enabled': true, 'statusBar.hints': false })

  runPluginMigrations()

  expect(aiUsageOverride()).toBe(true)
  // And the key it came from is gone, so nothing reads it twice.
  expect(loadConfig().settings).toEqual({ 'statusBar.hints': false })
})

test('a stored false needs no override — off is what the plugin already is', () => {
  writeStoredSettings({ 'statusBar.aiUsage.enabled': false })

  runPluginMigrations()

  expect(aiUsageOverride()).toBeUndefined()
  expect(loadConfig().settings).toEqual({})
})

test('it never overwrites an answer already given to the plugin itself', () => {
  writeStoredSettings({ 'statusBar.aiUsage.enabled': true })
  mkdirSync(profileDir(), { recursive: true })
  writeFileSync(
    join(profileDir(), 'aimux-plugins.json'),
    JSON.stringify({ overrides: { 'aimux.ai-usage': { enabled: false } }, plugins: [], version: 1 })
  )

  runPluginMigrations()

  expect(aiUsageOverride()).toBe(false)
  expect(loadConfig().settings).toEqual({})
})

test('running twice is running once — the second call has nothing to find', () => {
  writeStoredSettings({ 'statusBar.aiUsage.enabled': true })

  runPluginMigrations()
  runPluginMigrations()

  expect(aiUsageOverride()).toBe(true)
})

import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import type { SettingCtx, SettingRow } from '../../src/settings/types'
import type { AppState } from '../../src/state/types'

import { getConfigPath } from '../../src/config'
import {
  hydrateSettings,
  resetRow,
  settingsStore,
  writeRow,
} from '../../src/settings/settings-store'
import { createInitialState } from '../../src/state/store'

const originalHome = process.env.HOME
const originalProfile = process.env.AIMUX_PROFILE
const dirs: string[] = []
const applied: (boolean | number | string)[] = []

const TOGGLE: SettingRow = {
  apply: (value) => void applied.push(value),
  fallback: false,
  fromConfig: (config) => config.autoCommit?.enabled,
  id: 'autoCommit.enabled',
  kind: 'toggle',
  label: 'Auto-commit',
  storage: 'settings',
}

const DERIVED: SettingRow = {
  id: 'layout.projectBar',
  kind: 'toggle',
  label: 'Tab bar',
  read: (ctx) => ctx.state.projectBar.visible,
  storage: 'app',
  write: () => {
    throw new Error('an app row has no key of its own to reset')
  },
}

const STATE: AppState = createInitialState()

function ctx(): SettingCtx {
  return { state: STATE, values: settingsStore.getState().values }
}

function withConfig(body: Record<string, unknown>): string {
  const home = mkdtempSync(join(tmpdir(), 'aimux-settings-reset-'))
  dirs.push(home)
  process.env.HOME = home
  delete process.env.AIMUX_PROFILE
  const path = getConfigPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({ version: 2, ...body }))
  return path
}

function storedKeys(path: string): string[] {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { settings?: Record<string, unknown> }
  return Object.keys(parsed.settings ?? {})
}

afterEach(() => {
  process.env.HOME = originalHome
  if (originalProfile === undefined) delete process.env.AIMUX_PROFILE
  else process.env.AIMUX_PROFILE = originalProfile
  applied.length = 0
  settingsStore.setState({ fromConfigFile: new Set(), revision: 0, touched: new Set(), values: {} })
  for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

test('a row this screen wrote is marked as touched, one it never did is not', () => {
  withConfig({ settings: { 'autoCommit.enabled': true } })

  hydrateSettings([TOGGLE], {})

  expect(settingsStore.getState().touched.has('autoCommit.enabled')).toBe(true)
  expect(settingsStore.getState().touched.has('git.prefetchRadius')).toBe(false)
})

test('writing marks it, resetting unmarks it', () => {
  const path = withConfig({})
  hydrateSettings([TOGGLE], {})

  writeRow(TOGGLE, true, ctx())
  expect(settingsStore.getState().touched.has(TOGGLE.id)).toBe(true)
  expect(storedKeys(path)).toEqual([TOGGLE.id])

  resetRow(TOGGLE)

  // Removed from the file, not written as `false`: an absent key means "never
  // touched", which is what the marker and the next launch both read.
  expect(settingsStore.getState().touched.has(TOGGLE.id)).toBe(false)
  expect(storedKeys(path)).toEqual([])
})

test('resetting goes back to the default, and applies it', () => {
  withConfig({ settings: { 'autoCommit.enabled': true } })
  hydrateSettings([TOGGLE], {})
  applied.length = 0

  resetRow(TOGGLE)

  expect(settingsStore.getState().values[TOGGLE.id]).toBe(false)
  // Applied, not just forgotten: auto-commit would otherwise stay on until the
  // next launch while the screen claimed it was off.
  expect(applied).toEqual([false])
})

test('resetting a row the config file declares goes back to that, not to the default', () => {
  withConfig({ settings: { 'autoCommit.enabled': false } })
  hydrateSettings([TOGGLE], { autoCommit: { enabled: true } })

  // The config file already wins at startup, so this is the case where someone
  // changed it here for the session and then asked for it back.
  writeRow(TOGGLE, false, ctx())
  resetRow(TOGGLE)

  expect(settingsStore.getState().values[TOGGLE.id]).toBe(true)
})

test('a row whose value lives elsewhere has nothing to reset', () => {
  const path = withConfig({ settings: { 'autoCommit.enabled': true } })
  hydrateSettings([TOGGLE], {})

  resetRow(DERIVED)

  // No key of its own, so no key to remove — and certainly not someone else's.
  expect(storedKeys(path)).toEqual([TOGGLE.id])
})

test('resetting a row nobody touched does nothing at all', () => {
  const path = withConfig({ settings: { 'git.prefetchRadius': 9 } })
  hydrateSettings([TOGGLE], {})

  resetRow(TOGGLE)

  expect(storedKeys(path)).toEqual(['git.prefetchRadius'])
})

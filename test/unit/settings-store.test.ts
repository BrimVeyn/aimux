import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import type { SettingCtx, SettingRow } from '../../src/settings/types'
import type { AppState } from '../../src/state/types'

import { getConfigPath } from '../../src/config'
import {
  hydrateSettings,
  readRow,
  settingsStore,
  writeRow,
} from '../../src/settings/settings-store'
import { createInitialState } from '../../src/state/store'

const originalHome = process.env.HOME
const originalProfile = process.env.AIMUX_PROFILE
const originalRuntimeProfile = process.env.AIMUX_RUNTIME_PROFILE
const dirs: string[] = []

/**
 * Writes to wherever the loader will actually look. The profile comes from the
 * environment, so a guessed `…/aimux/default/aimux.json` silently misses whenever
 * one is set.
 */
function withConfig(body: Record<string, unknown>): string {
  const home = mkdtempSync(join(tmpdir(), 'aimux-settings-'))
  dirs.push(home)
  process.env.HOME = home
  delete process.env.AIMUX_PROFILE
  delete process.env.AIMUX_RUNTIME_PROFILE

  const path = getConfigPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({ version: 2, ...body }))
  return path
}

function readSettingsBlock(path: string): Record<string, unknown> {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { settings?: Record<string, unknown> }
  return parsed.settings ?? {}
}

const STATE: AppState = createInitialState()
const applied: (boolean | number | string)[] = []

/** A stored toggle wired to `autoCommit.enabled`, the shape most rows have. */
const TOGGLE: SettingRow = {
  apply: (value) => void applied.push(value),
  fallback: false,
  fromConfig: (config) => config.autoCommit?.enabled,
  id: 'autoCommit.enabled',
  kind: 'toggle',
  label: 'Auto-commit',
  storage: 'settings',
}

/** No `fromConfig`: nothing in the config file can ever claim this one. */
const UNCLAIMED: SettingRow = {
  fallback: 5,
  id: 'git.prefetchRadius',
  kind: 'number',
  label: 'Prefetch radius',
  max: 50,
  min: 0,
  step: 1,
  storage: 'settings',
}

const ROWS = [TOGGLE, UNCLAIMED]

function values(): Record<string, boolean | number | string> {
  return settingsStore.getState().values
}

/** `writeRow` compares against the current value, so it needs a read context. */
function ctx(): SettingCtx {
  return { state: STATE, values: settingsStore.getState().values }
}

afterEach(() => {
  process.env.HOME = originalHome
  if (originalProfile === undefined) delete process.env.AIMUX_PROFILE
  else process.env.AIMUX_PROFILE = originalProfile
  if (originalRuntimeProfile === undefined) delete process.env.AIMUX_RUNTIME_PROFILE
  else process.env.AIMUX_RUNTIME_PROFILE = originalRuntimeProfile
  applied.length = 0
  settingsStore.setState({ fromConfigFile: new Set(), values: {} })
  for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

test('a stored value wins over the built-in default', () => {
  withConfig({ settings: { 'autoCommit.enabled': true } })

  hydrateSettings(ROWS, {})

  expect(values()['autoCommit.enabled']).toBe(true)
  // Reaching the running app is the whole point: a value only the store knows
  // about would leave auto-commit off while the screen claims it is on.
  expect(applied).toEqual([true])
})

test('the config file wins over a stored value, and says so', () => {
  withConfig({ settings: { 'autoCommit.enabled': true } })

  hydrateSettings(ROWS, { autoCommit: { enabled: false } })

  expect(values()['autoCommit.enabled']).toBe(false)
  expect(settingsStore.getState().fromConfigFile.has('autoCommit.enabled')).toBe(true)
})

test('a row nothing claims falls back to its default', () => {
  withConfig({})

  hydrateSettings(ROWS, {})

  expect(values()['git.prefetchRadius']).toBe(5)
  expect(settingsStore.getState().fromConfigFile.size).toBe(0)
})

test('a stored value of the wrong type is dropped, not trusted', () => {
  withConfig({ settings: { 'autoCommit.enabled': { nested: true } } })

  hydrateSettings(ROWS, {})

  expect(values()['autoCommit.enabled']).toBe(false)
})

test('writing persists just that key and applies it', () => {
  const path = withConfig({ settings: { 'git.prefetchRadius': 9 } })
  hydrateSettings(ROWS, {})
  applied.length = 0

  writeRow(TOGGLE, true, ctx())

  // The other key survives, and the value that came from nowhere else does not
  // get written for free.
  expect(readSettingsBlock(path)).toEqual({ 'autoCommit.enabled': true, 'git.prefetchRadius': 9 })
  expect(applied).toEqual([true])
  expect(values()['autoCommit.enabled']).toBe(true)
})

test('a value from the config file is never baked into the json', () => {
  const path = withConfig({})
  hydrateSettings(ROWS, { autoCommit: { enabled: true } })

  writeRow(UNCLAIMED, 12, ctx())

  // Only the row that was written. Persisting `autoCommit.enabled` here would
  // outlive the config-file line it came from and quietly become permanent.
  expect(readSettingsBlock(path)).toEqual({ 'git.prefetchRadius': 12 })
})

test('an app-storage row delegates instead of persisting', () => {
  const path = withConfig({})
  const written: (boolean | number | string)[] = []
  const derived: SettingRow = {
    id: 'projectBar.visible',
    kind: 'toggle',
    label: 'Project bar',
    read: (readCtx) => readCtx.state.projectBar.visible,
    storage: 'app',
    write: (value) => void written.push(value),
  }

  // `false`, not `true`: the initial state already has the bar visible, and
  // writing the value a row already holds is a no-op by design.
  writeRow(derived, false, ctx())

  expect(written).toEqual([false])
  expect(readSettingsBlock(path)).toEqual({})
})

test('reading a stored row with no value at all yields its default', () => {
  withConfig({})

  expect(readRow(UNCLAIMED, { state: STATE, values: {} })).toBe(5)
})

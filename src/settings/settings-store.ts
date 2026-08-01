import type { AimuxUserConfig } from '@brimveyn/aimux-config'

import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import type { SettingCtx, SettingRow, SettingValue, StoredSettings } from './types'

import { loadConfig, saveConfig } from '../config'
import { logDebug } from '../debug/input-log'

export interface SettingsState {
  /** Effective value per row id, for the rows the settings screen owns. */
  values: StoredSettings
  /**
   * Rows the user's `aimux.config.ts` declares. Their value comes back from that
   * file at every launch, so an edit made here is good for this session only.
   */
  fromConfigFile: ReadonlySet<string>
}

const EMPTY_FROM_CONFIG: ReadonlySet<string> = new Set()

export const settingsStore = createStore<SettingsState>(() => ({
  fromConfigFile: EMPTY_FROM_CONFIG,
  values: {},
}))

export function useSettingsStore<T>(selector: (state: SettingsState) => T): T {
  return useStore(settingsStore, selector)
}

/**
 * Resolve every stored row and publish the result: the config file wins, then
 * whatever the settings screen last wrote, then the built-in default. The config
 * file is re-read at every launch, which is what makes its value the one that
 * comes back — see `docs/guide/settings.md`.
 *
 * The schema is a parameter rather than an import so this module stays downstream
 * of the sections, which read from it.
 */
export function hydrateSettings(rows: readonly SettingRow[], userConfig: AimuxUserConfig): void {
  const stored = loadConfig().settings ?? {}
  const values: StoredSettings = {}
  const fromConfigFile = new Set<string>()

  for (const row of rows) {
    if (row.kind === 'info' || row.storage !== 'settings') continue
    const declared = row.fromConfig?.(userConfig)
    if (declared !== undefined) fromConfigFile.add(row.id)
    const value = declared ?? stored[row.id] ?? row.fallback
    values[row.id] = value
    // Unconditional: the caller has already applied the config file's own values
    // (they are the baseline), and re-applying the same value is a no-op. What
    // matters is that a value coming from `stored` reaches the running app.
    row.apply?.(value)
  }

  settingsStore.setState({ fromConfigFile, values })
}

/**
 * Persist one value and apply it live. The merge reads the file rather than the
 * store: the store holds resolved values, so merging from it would bake a value
 * that came from `aimux.config.ts` into the JSON, where it would outlive the
 * config-file line it came from.
 */
function persist(id: string, value: SettingValue): boolean {
  const config = loadConfig()
  const settings: StoredSettings = { ...config.settings, [id]: value }
  if (saveConfig({ ...config, settings })) return true
  logDebug('settings.write.failed', { id })
  return false
}

export function readRow(row: SettingRow, ctx: SettingCtx): SettingValue {
  if (row.kind === 'info') return row.value(ctx)
  if (row.storage === 'app') return row.read(ctx)
  return ctx.values[row.id] ?? row.fallback
}

/**
 * Writing the value a row already has does nothing. That is not just an
 * optimisation: an `app` row delegates to the action behind the keybinding, and
 * several of those toggle rather than set — so handing one a value it already
 * holds would flip it the wrong way. One rule here beats a guard per row.
 */
export function writeRow(row: SettingRow, value: SettingValue, ctx: SettingCtx): void {
  if (row.kind === 'info') return
  if (readRow(row, ctx) === value) return
  if (row.storage === 'app') {
    row.write(value, ctx)
    return
  }
  if (!persist(row.id, value)) return
  settingsStore.setState((state) => ({ values: { ...state.values, [row.id]: value } }))
  row.apply?.(value)
}

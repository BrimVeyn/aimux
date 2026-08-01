import type { AimuxUserConfig } from '@brimveyn/aimux-config'

import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import type { SettingCtx, SettingRow, SettingValue, StoredSettings } from './types'

import { loadConfig, saveConfig } from '../config'
import { logDebug } from '../debug/input-log'
import { toast } from '../state/toast-store'

export interface SettingsState {
  /** Bumped by every write. Rows whose value lives in a file have no other way
   *  to tell the screen to look again. */
  revision: number
  /** Effective value per row id, for the rows the settings screen owns. */
  values: StoredSettings
  /**
   * Rows the user's `aimux.config.ts` declares. Their value comes back from that
   * file at every launch, so an edit made here is good for this session only.
   */
  fromConfigFile: ReadonlySet<string>
  /**
   * Rows this screen has a value written for. Not the same as "differs from the
   * default" — someone may have set a row back to its default value — but it is
   * what "reset" removes, so it is what the marker has to mean.
   */
  touched: ReadonlySet<string>
  /**
   * What each row would hold if this screen had never touched it: the config
   * file's value where it declares one, else the built-in default. Resolved once,
   * at hydration, because that is when the config file was read — recomputing it
   * later would read a file the rest of the app has not.
   */
  defaults: StoredSettings
}

const EMPTY_FROM_CONFIG: ReadonlySet<string> = new Set()

export const settingsStore = createStore<SettingsState>(() => ({
  defaults: {},
  fromConfigFile: EMPTY_FROM_CONFIG,
  revision: 0,
  touched: EMPTY_FROM_CONFIG,
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
  const defaults: StoredSettings = {}
  const fromConfigFile = new Set<string>()

  for (const row of rows) {
    if (row.kind === 'info' || row.kind === 'action' || row.storage !== 'settings') continue
    const declared = row.fromConfig?.(userConfig)
    if (declared !== undefined) fromConfigFile.add(row.id)
    defaults[row.id] = declared ?? row.fallback
    const value = declared ?? stored[row.id] ?? row.fallback
    values[row.id] = value
    // Unconditional: the caller has already applied the config file's own values
    // (they are the baseline), and re-applying the same value is a no-op. What
    // matters is that a value coming from `stored` reaches the running app.
    row.apply?.(value)
  }

  settingsStore.setState((state) => ({
    defaults,
    fromConfigFile,
    revision: state.revision + 1,
    touched: new Set(Object.keys(stored)),
    values,
  }))
}

/**
 * Persist one value and apply it live. The merge reads the file rather than the
 * store: the store holds resolved values, so merging from it would bake a value
 * that came from `aimux.config.ts` into the JSON, where it would outlive the
 * config-file line it came from.
 */
function persist(id: string, value: SettingValue | undefined): boolean {
  const config = loadConfig()
  const settings: StoredSettings = { ...config.settings }
  if (value === undefined) delete settings[id]
  else settings[id] = value
  if (saveConfig({ ...config, settings })) return true
  // Loud, not just logged: a read-only config directory or a full disk otherwise
  // shows up as a key that does nothing, with no explanation anywhere.
  logDebug('settings.write.failed', { id })
  toast.error('Could not save that setting — see `aimux doctor`')
  return false
}

export function readRow(row: SettingRow, ctx: SettingCtx): SettingValue {
  if (row.kind === 'info' || row.kind === 'action') return row.value(ctx)
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
  if (row.kind === 'info' || row.kind === 'action') return
  if (readRow(row, ctx) === value) return
  if (row.storage === 'app') {
    row.write(value, ctx)
    bumpRevision()
    return
  }
  if (!persist(row.id, value)) return
  settingsStore.setState((state) => ({
    revision: state.revision + 1,
    touched: new Set(state.touched).add(row.id),
    values: { ...state.values, [row.id]: value },
  }))
  row.apply?.(value)
}

/**
 * Forget what this screen wrote for a row and go back to what the row would have
 * been without it: the config file's value if it declares one, else the built-in
 * default. Only the rows this screen owns — an `app` row's value has its own home
 * and its own idea of a default.
 */
export function resetRow(row: SettingRow): void {
  if (row.kind === 'info' || row.kind === 'action' || row.storage !== 'settings') return
  if (!settingsStore.getState().touched.has(row.id)) return
  if (!persist(row.id, undefined)) return

  const value = settingsStore.getState().defaults[row.id] ?? row.fallback
  settingsStore.setState((state) => {
    const touched = new Set(state.touched)
    touched.delete(row.id)
    return { revision: state.revision + 1, touched, values: { ...state.values, [row.id]: value } }
  })
  row.apply?.(value)
}

/**
 * Tells the screen that what it is showing may be out of date. Needed because a
 * row's value can live outside both stores — the setup script is a file — and
 * nothing else would make the list read it again.
 */
function bumpRevision(): void {
  settingsStore.setState((state) => ({ revision: state.revision + 1 }))
}

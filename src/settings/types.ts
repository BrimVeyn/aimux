import type { AimuxUserConfig } from '@brimveyn/aimux-config'

import type { AppState } from '../state/types'

export type SettingValue = boolean | number | string

/**
 * The values the settings screen owns, keyed by row id. Sparse on purpose: a
 * missing key means "never touched", which is not the same as `false`.
 */
export type StoredSettings = Record<string, SettingValue>

export interface SettingCtx {
  state: AppState
  values: StoredSettings
}

export interface SettingOption {
  value: SettingValue
  label: string
}

/** How a row draws itself, and what activating it does. */
type SettingKind =
  | { kind: 'toggle' }
  | { kind: 'select'; options: readonly SettingOption[] }
  | { kind: 'number'; min: number; max: number; step: number }

interface SettingRowBase {
  id: string
  label: string
  description?: string
}

/**
 * A row with no other home for its value: it lives in the `settings` block of
 * `aimux.json`, and `readRow`/`writeRow` reach it by id. Nothing here repeats
 * the id, so a row can't read one key and write another.
 */
interface StoredRow {
  storage: 'settings'
  /** Used when neither the config file nor the settings screen has a value. */
  fallback: SettingValue
  /**
   * The value the user's `aimux.config.ts` declares for this row, or undefined
   * when it doesn't declare it. Declared means it wins at every startup — a UI
   * edit then lasts until the next launch, and the row says so.
   */
  fromConfig?: (config: AimuxUserConfig) => SettingValue | undefined
  /** Hands a new value to the running app. Absent → the row needs a restart. */
  apply?: (value: SettingValue) => void
}

/**
 * A view over a value `AppState` already owns (git pane preferences, bar
 * visibility, …). It delegates to that value's existing action or side effect
 * rather than keeping a second copy.
 */
interface DerivedRow {
  storage: 'app'
  read: (ctx: SettingCtx) => SettingValue
  write: (value: SettingValue) => void
}

export type SettingRow =
  | (SettingRowBase & SettingKind & StoredRow)
  | (SettingRowBase & SettingKind & DerivedRow)
  | (SettingRowBase & { kind: 'info'; value: (ctx: SettingCtx) => string })

export interface SettingSection {
  id: string
  label: string
  rows: SettingRow[]
}

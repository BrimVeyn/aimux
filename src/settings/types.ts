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
  /** Activating it opens a one-field modal. Empty means "unset", not "empty string". */
  | { kind: 'text'; placeholder?: string }

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
  /**
   * Hands a new value to whatever owns it in the running app. Not every live row
   * needs one — a value whose only reader subscribes to this store is live on its
   * own, which is why "needs a restart" is declared rather than inferred.
   */
  apply?: (value: SettingValue) => void
  /** The running app won't see the new value; the row says so. */
  restart?: true
}

/**
 * A view over a value `AppState` already owns (git pane preferences, bar
 * visibility, …). It delegates to that value's existing action or side effect
 * rather than keeping a second copy.
 */
interface DerivedRow {
  storage: 'app'
  read: (ctx: SettingCtx) => SettingValue
  /** Same context `read` gets, so a write that has to merge into a record can. */
  write: (value: SettingValue, ctx: SettingCtx) => void
}

export type SettingRow =
  | (SettingRowBase & SettingKind & StoredRow)
  | (SettingRowBase & SettingKind & DerivedRow)
  | (SettingRowBase & { kind: 'info'; value: (ctx: SettingCtx) => string })
  /**
   * Not a setting: a button. For the things a row cannot hold — a multi-line
   * script, a list — where the honest move is to hand over to whatever can.
   */
  | (SettingRowBase & { kind: 'action'; value: (ctx: SettingCtx) => string; run: () => void })

export interface SettingSection {
  id: string
  label: string
  /** Shown once under the section's title, for a caveat that covers every row. */
  description?: string
  /**
   * A function when the rows depend on state — one row per project, say. It is
   * called during render and while handling a key, so it must stay cheap.
   */
  rows: SettingRow[] | ((state: AppState) => SettingRow[])
}

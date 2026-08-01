import type { AimuxUserConfig } from '@brimveyn/aimux-config'

import type { AppState, ProjectRecord } from '../state/types'

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
   * A function when the rows depend on the projects — one row per project, say.
   * The projects and nothing else: a builder handed the whole state would be free
   * to depend on anything in it, and every caller would have to have all of it.
   *
   * Building a row may cost something (Setup reads a script off disk), so anything
   * that only needs to know *how many* rows there are asks `rowCount` instead.
   */
  rows: SettingRow[] | ((projects: readonly ProjectRecord[]) => SettingRow[])
  /**
   * How many rows there will be, without building them. Required alongside a
   * dynamic `rows`, and kept honest by `settings-schema.test.ts`: the reducer
   * clamps the cursor with this, and a count that disagrees with the list is a
   * cursor that stops one row short of the end, or one past it.
   */
  rowCount?: (projects: readonly ProjectRecord[]) => number
}

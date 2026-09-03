// -----------------------------------------------------------------------------
// The settings screen's row and section shapes.
//
// In this package rather than in `src/` because a plugin registers a settings
// section, and a plugin has to be able to type one without depending on the
// aimux binary. `src/settings/types.ts` re-exports from here.
// -----------------------------------------------------------------------------

import type { AppState, ProjectRecord } from './app-types'
import type { AimuxUserConfig } from './types'

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

/**
 * A row over one key of a plugin's configuration.
 *
 * Not a `settings` row: that block of `aimux.json` is never read by plugin
 * discovery, so a value written there would silently reach no plugin. Not an
 * `app` row either — its value has neither a home in `AppState` nor a place in
 * the settings screen's hydration, and the two marks a plugin row most needs
 * (`~` the registry has an override, `*` `aimux.config.ts` declares it and
 * keeps winning) come from the plugin's own layers rather than from this
 * screen's bookkeeping.
 *
 * The three functions are closures, like `DerivedRow`'s: the settings store
 * must not learn how to reach a plugin registry.
 */
interface PluginConfigRow {
  storage: 'plugin'
  /** For the detail view, and for a test to name the row it means. */
  pluginId: string
  field: string
  /** Never rendered and edited from empty. */
  secret?: boolean
  /** `aimux.config.ts` declares this key and keeps winning. Drives `*`. */
  fromConfigFile: boolean
  /** A layer above the manifest default set it. Drives `~`. */
  isSet: boolean
  read: () => SettingValue
  write: (value: SettingValue) => void
  /** Drop the override and fall back through the layers underneath. */
  reset: () => void
}

/** A row whose value lives in the `settings` block of `aimux.json`. */
export type StoredSettingRow = SettingRowBase & SettingKind & StoredRow

/** A row over one key of a plugin's config. Narrowed by `storage === 'plugin'`. */
export type PluginSettingRow = SettingRowBase & SettingKind & PluginConfigRow

export type SettingRow =
  | StoredSettingRow
  | PluginSettingRow
  | (SettingRowBase & SettingKind & DerivedRow)
  | (SettingRowBase & { kind: 'info'; value: (ctx: SettingCtx) => string })
  /**
   * Not a setting: a button. For the things a row cannot hold — a multi-line
   * script, a list — where the honest move is to hand over to whatever can.
   */
  | (SettingRowBase & { kind: 'action'; value: (ctx: SettingCtx) => string; run: () => void })

export interface SettingSection {
  id: string
  /**
   * One cell, text presentation, present in the base fonts — the same rule the
   * stats screen's section glyphs follow, so the eye finds a section by shape
   * before it reads the label.
   *
   * Required, and on the section rather than in a lookup keyed by id: a map
   * would need a fallback, and a fallback turns a renamed or added section into
   * a silent placeholder instead of a compile error.
   */
  glyph: string
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

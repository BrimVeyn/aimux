import type { SettingCtx, SettingRow, SettingValue } from '../settings/types'
import type { AppState } from '../state/types'
import type { SideEffectContext } from './side-effect-context'

import { filterSettingRows } from '../settings/search'
import { findSettingRow } from '../settings/sections'
import { readRow, resetRow, settingsStore, writeRow } from '../settings/settings-store'
import { dispatchGlobal } from '../state/dispatch-ref'
import { toast } from '../state/toast-store'

type SettingsContext = Pick<SideEffectContext, 'getState'>

/** Steps like 0.05 otherwise accumulate binary noise into the persisted value. */
function round(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function nextOptionValue(
  options: readonly { value: SettingValue }[],
  current: SettingValue,
  delta: 1 | -1
): SettingValue | undefined {
  // -1 when the current value isn't one of the options. Hydration keeps that from
  // happening to a row this screen stores, so what is left is a row reading a
  // value that lives elsewhere; stepping forward from -1 lands on the first
  // option, which is how it heals.
  const index = options.findIndex((option) => option.value === current)
  const size = options.length
  if (size === 0) return undefined
  return options[(index + delta + size) % size]?.value
}

/**
 * One press, one step. Deliberately not a fraction of the range: every number
 * row here crosses its own range in under sixty presses, because each declares
 * a `step` scaled to what it measures — so a "drag the gauge" stride would be
 * arithmetic wrapped around a number the row already got right.
 */
function nextNumberValue(
  row: Extract<SettingRow, { kind: 'number' }>,
  current: SettingValue,
  delta: 1 | -1
): number {
  const base = typeof current === 'number' ? current : row.min
  // Clamped, never wrapped: a direction is a direction, and holding `l` on a
  // width until it snaps to the narrowest is not what anyone meant.
  return Math.min(row.max, Math.max(row.min, round(base + delta * row.step)))
}

/** Asks for a field, seeded with what the row holds. */
function openField(row: SettingRow, current: SettingValue): void {
  dispatchGlobal({
    label: row.label,
    settingId: row.id,
    type: 'open-setting-text-modal',
    value: String(current),
  })
}

function readCtx(state: AppState): SettingCtx {
  return { state, values: settingsStore.getState().values }
}

/**
 * The row under the cursor. Unfiltered, because the cursor counts every row on
 * the screen — the same list `filterSettingRows` numbers its hits against.
 */
function selectedRow(state: AppState): SettingRow | undefined {
  if (state.focusMode !== 'settings') return undefined
  return filterSettingRows(state.projects, null)[state.settings.rowIndex]?.row
}

/**
 * One entry point for every kind of row. `delta` is the direction asked for
 * (`-`/`+`); without it the row advances the way activating it should — a toggle
 * flips, an enum steps forward, a number steps up, a text field opens.
 */
export function changeSelectedSetting(runtime: SettingsContext, delta?: 1 | -1): void {
  const state = runtime.getState()
  const row = selectedRow(state)
  if (!row || row.kind === 'info') return

  const ctx = readCtx(state)
  const current = readRow(row, ctx)

  switch (row.kind) {
    case 'toggle':
      // `-`/`+` set the value rather than flipping it: holding + on a checkbox
      // should settle on "on", not blink.
      writeRow(row, delta === undefined ? current !== true : delta === 1, ctx)
      return
    case 'select': {
      const next = nextOptionValue(row.options, current, delta ?? 1)
      if (next !== undefined) writeRow(row, next, ctx)
      return
    }
    case 'number':
      // `-`/`+` step it; <CR> asks for the number. Stepping alone meant 59
      // presses to cross the AI usage refresh interval.
      if (delta === undefined) openField(row, current)
      else writeRow(row, nextNumberValue(row, current, delta), ctx)
      return
    case 'text':
      // Nothing a keystroke can advance, so activating hands over to a field.
      // `-`/`+` have nothing to do on one.
      if (delta === undefined) openField(row, current)
      return
    case 'action':
      // Not a value, so a direction means nothing to it either.
      if (delta === undefined) row.run()
      return
    default:
      row satisfies never
  }
}

/**
 * Move the screen's cursor onto the setting the search had highlighted. The hit
 * carries its position in the screen's list, so there is nothing to look up —
 * and the list is recomputed from the same filter the picker drew, so the index
 * still means what it meant.
 */
export function confirmSettingsSearch(runtime: SettingsContext): void {
  const state = runtime.getState()
  if (state.modal.type !== 'settings-search') return
  const hit = filterSettingRows(state.projects, state.modal.editBuffer)[state.modal.selectedIndex]
  dispatchGlobal({ type: 'close-modal' })
  if (!hit) return
  dispatchGlobal({ rowIndex: hit.rowIndex, type: 'settings-select-row' })
}

/** Puts the selected row back to what it would be if this screen had never run. */
export function resetSelectedSetting(runtime: SettingsContext): void {
  const row = selectedRow(runtime.getState())
  if (row) resetRow(row)
}

/** Applies what the text field was holding when it was confirmed. */
export function commitSettingText(
  runtime: SettingsContext,
  settingId: string,
  value: string
): void {
  const state = runtime.getState()
  // Dynamic rows included: a per-project setup command is a text row that exists
  // only while its project does.
  const row = findSettingRow(settingId, state.projects)
  if (!row) return
  const ctx = readCtx(state)

  if (row.kind === 'number') {
    const parsed = Number(value.trim())
    if (!Number.isFinite(parsed)) {
      toast.error(`${row.label} takes a number`)
      return
    }
    // Clamped rather than refused: someone typing 10 into a field whose floor is
    // 60 meant "as low as it goes", and saying so beats doing nothing.
    const clamped = Math.min(row.max, Math.max(row.min, parsed))
    if (clamped !== parsed) toast.info(`${row.label} clamped to ${String(clamped)}`)
    writeRow(row, clamped, ctx)
    return
  }

  if (row.kind !== 'text') return
  writeRow(row, value.trim(), ctx)
}

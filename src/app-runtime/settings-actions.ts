import type { SettingRow, SettingValue } from '../settings/types'
import type { AppState } from '../state/types'
import type { SideEffectContext } from './side-effect-context'

import { findSettingRow, getSectionRows } from '../settings/sections'
import { readRow, settingsStore, writeRow } from '../settings/settings-store'
import { dispatchGlobal } from '../state/dispatch-ref'

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
  // -1 when the stored value isn't one of the options any more (a renamed option,
  // a hand-edited config): stepping forward from there lands on the first, which
  // is how the row heals itself.
  const index = options.findIndex((option) => option.value === current)
  const size = options.length
  if (size === 0) return undefined
  return options[(index + delta + size) % size]?.value
}

function nextNumberValue(
  row: Extract<SettingRow, { kind: 'number' }>,
  current: SettingValue,
  delta: 1 | -1,
  wrap: boolean
): number {
  const base = typeof current === 'number' ? current : row.min
  const next = round(base + delta * row.step)
  // `-`/`+` name a direction, so they clamp — holding + on a width and having it
  // snap to the narrowest is not what anyone meant. <CR> names no direction, so
  // it cycles: on a row already at its max it has to do something visible.
  if (next > row.max) return wrap ? row.min : row.max
  if (next < row.min) return wrap ? row.max : row.min
  return next
}

function readCtx(state: AppState): { state: AppState; values: Record<string, SettingValue> } {
  return { state, values: settingsStore.getState().values }
}

/**
 * One entry point for every kind of row. `delta` is the direction asked for
 * (`-`/`+`); without it the row advances the way activating it should — a toggle
 * flips, an enum steps forward, a number steps up, a text field opens.
 */
export function changeSelectedSetting(runtime: SettingsContext, delta?: 1 | -1): void {
  const state = runtime.getState()
  if (state.focusMode !== 'settings' || state.settings.pane !== 'rows') return

  const row = getSectionRows(state.settings.sectionId, state)[state.settings.rowIndex]
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
      writeRow(row, nextNumberValue(row, current, delta ?? 1, delta === undefined), ctx)
      return
    case 'text':
      // Text is the one kind a keystroke can't advance, so activating it hands
      // over to a field. `-`/`+` have nothing to do on one.
      if (delta === undefined) {
        dispatchGlobal({
          label: row.label,
          settingId: row.id,
          type: 'open-setting-text-modal',
          value: String(current),
        })
      }
      return
    case 'action':
      // Not a value, so a direction means nothing to it either.
      if (delta === undefined) row.run()
      return
    default:
      row satisfies never
  }
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
  const row = findSettingRow(settingId, state)
  if (!row || row.kind !== 'text') return
  writeRow(row, value.trim(), readCtx(state))
}

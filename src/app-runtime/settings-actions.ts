import type { SettingRow, SettingValue } from '../settings/types'
import type { SideEffectContext } from './side-effect-context'

import { getSectionRows } from '../settings/sections'
import { readRow, settingsStore, writeRow } from '../settings/settings-store'

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
  delta: 1 | -1
): number {
  const base = typeof current === 'number' ? current : row.min
  const next = round(base + delta * row.step)
  // Wrap instead of sitting at the end: <CR> on a row that is already at its max
  // has to visibly do something, or it reads as a dead key.
  if (next > row.max) return row.min
  if (next < row.min) return row.max
  return next
}

/**
 * One entry point for every kind of row. `delta` is the direction asked for
 * (`-`/`+`); without it the row advances the way activating it should — a toggle
 * flips, an enum steps forward, a number steps up.
 */
export function changeSelectedSetting(ctx: SettingsContext, delta?: 1 | -1): void {
  const state = ctx.getState()
  if (state.focusMode !== 'settings' || state.settings.pane !== 'rows') return

  const row = getSectionRows(state.settings.sectionId)[state.settings.rowIndex]
  if (!row || row.kind === 'info') return

  const current = readRow(row, { state, values: settingsStore.getState().values })

  switch (row.kind) {
    case 'toggle':
      // `-`/`+` set the value rather than flipping it: holding + on a checkbox
      // should settle on "on", not blink.
      writeRow(row, delta === undefined ? current !== true : delta === 1)
      return
    case 'select': {
      const next = nextOptionValue(row.options, current, delta ?? 1)
      if (next !== undefined) writeRow(row, next)
      return
    }
    case 'number':
      writeRow(row, nextNumberValue(row, current, delta ?? 1))
      return
    default:
      row satisfies never
  }
}

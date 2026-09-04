import { memo } from 'react'

import type { SettingRow, SettingValue } from '../../../settings/types'

import { formatNotationForDisplay } from '../../../input/keymap/key-format'
import { readRow, useSettingsStore } from '../../../settings/settings-store'
import { useAppStore } from '../../../state/app-store'
import { type ResolvedTuiTheme, useTheme } from '../../theme'
import { truncate } from '../../truncate'

/** Filled means on. Both are one cell wide in a Latin-width terminal. */
const ON = '●'
const OFF = '○'

/** What a row shows on its right edge, per kind. */
export function formatValue(row: SettingRow, value: SettingValue): string {
  switch (row.kind) {
    case 'toggle':
      return value === true ? ON : OFF
    case 'select': {
      const option = row.options.find((entry) => entry.value === value)
      return `${option?.label ?? String(value)} ›`
    }
    case 'number':
      return String(value)
    case 'text': {
      const text = String(value)
      return text === '' ? (row.placeholder ?? 'not set') : text
    }
    case 'keybind':
      return String(value) === '' ? 'unbound' : formatNotationForDisplay(String(value))
    case 'info':
    case 'action':
      return String(value)
    default:
      row satisfies never
      return ''
  }
}

/**
 * The same value in prose, for the line under the label. The column wants a glyph
 * you can scan; a sentence wants a word — `default: ●` is not a sentence.
 */
export function describeValue(row: SettingRow, value: SettingValue): string {
  switch (row.kind) {
    case 'toggle':
      return value === true ? 'on' : 'off'
    case 'select':
      return row.options.find((entry) => entry.value === value)?.label ?? String(value)
    case 'text':
      return String(value) === '' ? 'empty' : String(value)
    case 'keybind':
      return String(value) === '' ? 'unbound' : String(value)
    default:
      return String(value)
  }
}

/**
 * Text wears text tokens, the way it does on the stats screen — a value is not a
 * status. The two exceptions earn it: a toggle whose colour *is* its state, and
 * an action row, where the colour is the affordance saying it does something.
 */
function valueColor(row: SettingRow, value: SettingValue, t: ResolvedTuiTheme): string {
  // A toggle is read at a glance or not at all, so its state is the colour as much
  // as the glyph: lit when on, as quiet as the rest of the row when off.
  if (row.kind === 'toggle') return value === true ? t.success : t.textMuted
  if (row.kind === 'action') return t.primary
  return row.kind === 'info' ? t.textMuted : t.text
}

/**
 * A row's current value, read by the row itself.
 *
 * Per row rather than per list on purpose: a value is a primitive, so a PTY frame
 * that rewrites `tabs` re-runs this selector, gets the same value back, and
 * renders nothing. A parent subscribing to the whole store for every row in the
 * list would repaint it at the rate the terminals print.
 */
export const RowValue = memo(function RowValue({
  fg,
  maxWidth,
  row,
}: {
  /**
   * Overrides the value's own colour. A row filled with `primary` has room for
   * one ink, so the search results hand theirs down rather than let a green
   * toggle sit on the accent.
   */
  fg?: string
  /** Cropped rather than wrapped: a row that grows a line shifts the list. */
  maxWidth?: number
  row: SettingRow
}) {
  const t = useTheme()
  const values = useSettingsStore((s) => s.values)
  const value = useAppStore((s) => readRow(row, { state: s, values }))
  const text = formatValue(row, value)
  return (
    <text fg={fg ?? valueColor(row, value, t)} wrapMode="none">
      {maxWidth === undefined ? text : truncate(text, maxWidth)}
    </text>
  )
})

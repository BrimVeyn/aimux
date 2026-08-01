import { memo } from 'react'

import type { SettingRow, SettingValue } from '../../../settings/types'

import { readRow, useSettingsStore } from '../../../settings/settings-store'
import { useAppStore } from '../../../state/app-store'
import { type ResolvedTuiTheme, useTheme } from '../../theme'

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
    default:
      return String(value)
  }
}

function valueColor(row: SettingRow, value: SettingValue, t: ResolvedTuiTheme): string {
  // A toggle is read at a glance or not at all, so its state is the colour as much
  // as the glyph: lit when on, as quiet as the rest of the row when off.
  if (row.kind === 'toggle') return value === true ? t.success : t.textMuted
  return row.kind === 'info' ? t.textMuted : t.primary
}

/**
 * A row's current value, read by the row itself.
 *
 * Per row rather than per list on purpose: a value is a primitive, so a PTY frame
 * that rewrites `tabs` re-runs this selector, gets the same value back, and
 * renders nothing. A parent subscribing to the whole store for every row in the
 * list would repaint it at the rate the terminals print.
 */
export const RowValue = memo(function RowValue({ row }: { row: SettingRow }) {
  const t = useTheme()
  const values = useSettingsStore((s) => s.values)
  const value = useAppStore((s) => readRow(row, { state: s, values }))
  return <text fg={valueColor(row, value, t)}>{formatValue(row, value)}</text>
})

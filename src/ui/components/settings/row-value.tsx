import { memo } from 'react'

import type { SettingRow, SettingValue } from '../../../settings/types'

import { readRow, useSettingsStore } from '../../../settings/settings-store'
import { useAppStore } from '../../../state/app-store'
import { useTheme } from '../../theme'

/** What a row shows on its right edge, per kind. */
export function formatValue(row: SettingRow, value: SettingValue): string {
  switch (row.kind) {
    case 'toggle':
      return value === true ? '[x]' : '[ ]'
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
  return <text fg={row.kind === 'info' ? t.textMuted : t.primary}>{formatValue(row, value)}</text>
})

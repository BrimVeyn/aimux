import { memo } from 'react'

import type { SettingRow, SettingValue } from '../../../settings/types'

import { readRow, useSettingsStore } from '../../../settings/settings-store'
import { useAppStore } from '../../../state/app-store'
import { useTheme } from '../../theme'
import { ListItem } from '../primitives/list-item'

/** What a row shows on its right edge, per kind. */
function formatValue(row: SettingRow, value: SettingValue): string {
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
      return String(value)
    default:
      row satisfies never
      return ''
  }
}

/** True when changing this row writes a value the running app won't pick up. */
function needsRestart(row: SettingRow): boolean {
  return row.kind !== 'info' && row.storage === 'settings' && row.restart === true
}

interface SettingsRowProps {
  row: SettingRow
  active: boolean
  index: number
  onSelect: (index: number) => void
}

export const SettingsRow = memo(function SettingsRow({
  active,
  index,
  onSelect,
  row,
}: SettingsRowProps) {
  const t = useTheme()
  const values = useSettingsStore((s) => s.values)
  // Each row subscribes to its own value rather than the parent subscribing to
  // the whole store: a row's value is a primitive, so a PTY frame that rewrites
  // `tabs` re-runs this selector, gets the same value, and renders nothing.
  const value = useAppStore((s) => readRow(row, { state: s, values }))
  const fromConfigFile = useSettingsStore((s) => s.fromConfigFile.has(row.id))
  const editable = row.kind !== 'info'

  // Only the focused row explains itself: a description under every row would
  // treble the height of the list and bury the values.
  const notes: string[] = []
  if (active) {
    if (row.description != null && row.description !== '') notes.push(row.description)
    if (fromConfigFile) notes.push('set in aimux.config.ts — comes back on restart')
    else if (needsRestart(row)) notes.push('applies on restart')
  }

  return (
    <ListItem
      id={`setting-row-${row.id}`}
      active={active}
      index={index}
      onClickIndex={onSelect}
      title={<text fg={editable ? t.text : t.textMuted}>{row.label}</text>}
      subtitle={notes.length > 0 ? <text fg={t.textMuted}>{notes.join(' · ')}</text> : undefined}
      trailing={
        <box flexDirection="row">
          {fromConfigFile ? <text fg={t.warning}>* </text> : null}
          <text fg={editable ? t.primary : t.textMuted}>{formatValue(row, value)}</text>
        </box>
      }
    />
  )
})

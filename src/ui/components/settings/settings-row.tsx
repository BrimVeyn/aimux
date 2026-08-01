import { memo } from 'react'

import type { SettingRow } from '../../../settings/types'

import { useSettingsStore } from '../../../settings/settings-store'
import { useTheme } from '../../theme'
import { ListItem } from '../primitives/list-item'
import { RowValue } from './row-value'

/** True when changing this row writes a value the running app won't pick up. */
function needsRestart(row: SettingRow): boolean {
  if (row.kind === 'info' || row.kind === 'action') return false
  return row.storage === 'settings' && row.restart === true
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
  const fromConfigFile = useSettingsStore((s) => s.fromConfigFile.has(row.id))
  const touched = useSettingsStore((s) => s.touched.has(row.id))
  const editable = row.kind !== 'info'

  // Always, never only on the focused row: a row that grows a line when you land
  // on it shifts everything under it, so the list moves under the cursor the
  // whole way down. A taller list that holds still reads better than a compact
  // one that does not.
  const notes: string[] = []
  if (row.description != null && row.description !== '') notes.push(row.description)
  if (fromConfigFile) notes.push('set in aimux.config.ts — comes back on restart')
  else if (needsRestart(row)) notes.push('applies on restart')

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
          {/* `*` the config file owns it, `•` this screen wrote it (r resets). */}
          {fromConfigFile ? <text fg={t.warning}>* </text> : null}
          {!fromConfigFile && touched ? <text fg={t.secondary}>• </text> : null}
          <RowValue row={row} />
        </box>
      }
    />
  )
})

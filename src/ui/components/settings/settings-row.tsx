import { memo } from 'react'

import type { SettingRow } from '../../../settings/types'

import { storedRow, useSettingsStore } from '../../../settings/settings-store'
import { useTheme } from '../../theme'
import { ListItem } from '../primitives/list-item'
import { describeValue, RowValue } from './row-value'

/** Where the value comes from, on the left, out of the value column's way. */
const CONFIG_FILE_MARK = '*'
const TOUCHED_MARK = '~'

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
  const defaultValue = useSettingsStore((s) => s.defaults[row.id])
  const editable = row.kind !== 'info'
  // A blank when neither applies, never nothing: a marker that comes and goes
  // would shift the label of every row it is missing from.
  let mark = ' '
  if (fromConfigFile) mark = CONFIG_FILE_MARK
  else if (touched) mark = TOUCHED_MARK

  // Always, never only on the focused row: a row that grows a line when you land
  // on it shifts everything under it, so the list moves under the cursor the
  // whole way down. A taller list that holds still reads better than a compact
  // one that does not.
  const notes: string[] = []
  if (row.description != null && row.description !== '') notes.push(row.description)
  if (fromConfigFile) notes.push('set in aimux.config.ts — comes back on restart')
  else if (storedRow(row)?.restart === true) notes.push('applies on restart')
  // Right-aligned on the same line rather than tacked onto the end of the
  // description: it is about the row, not about what the setting does, and the
  // value column above it is on that edge too. Only once the row has been
  // changed — `r` is otherwise a key you press to find out what it does.
  const resetHint =
    touched && defaultValue !== undefined ? `r resets to ${describeValue(row, defaultValue)}` : null

  return (
    <ListItem
      id={`setting-row-${row.id}`}
      active={active}
      index={index}
      onClickIndex={onSelect}
      leading={<text fg={fromConfigFile ? t.warning : t.secondary}>{mark}</text>}
      title={<text fg={editable ? t.text : t.textMuted}>{row.label}</text>}
      subtitle={
        notes.length > 0 || resetHint != null ? (
          <box flexDirection="row">
            <box flexGrow={1} flexShrink={1}>
              <text fg={t.textMuted}>{notes.join(' · ')}</text>
            </box>
            {resetHint != null ? (
              <text fg={t.textMuted} wrapMode="none">
                {resetHint}
              </text>
            ) : null}
          </box>
        ) : undefined
      }
      trailing={<RowValue row={row} />}
    />
  )
})

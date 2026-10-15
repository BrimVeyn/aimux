import { memo } from 'react'

import type { SettingRow } from '../../../settings/types'

import { rowMarks } from '../../../settings/row-marks'
import { useSettingsStore } from '../../../settings/settings-store'
import { useSelectionInk } from '../../selection-ink'
import { useTheme } from '../../theme'
import { truncate } from '../../truncate'
import { ListItem } from '../primitives/list-item'
import { RowValue } from './row-value'

/**
 * Where the value comes from, in the gutter left of the label. The footer says
 * what the mark means for the row you are on — `default: …` for a changed row,
 * the config file for one it pins.
 */
const CONFIG_FILE_MARK = '*'
const TOUCHED_MARK = '~'

/** The cursor, the mark, their spaces, and the row's own padding either side. */
const ROW_CHROME = 6
/**
 * Every label there is fits in this, so the values all start on one column —
 * right after the labels, not across the screen from them. (`Auto-rename
 * minimum words` is the longest at 25.)
 */
const LABEL_MAX = 28

interface SettingsRowProps {
  row: SettingRow
  active: boolean
  index: number
  /** The column this row stands in — it fills it, edge to edge. */
  width: number
  onSelect: (index: number) => void
}

/**
 * One line: the label, and its value right beside it. What the setting does is
 * the footer's job, for the row you are on — a description under every row made
 * a section of eight settings a screen of prose.
 *
 * Filled with `primary` like every other list: with the gauges gone, no colour on
 * the row is information the fill would swallow — a toggle says `on`/`off` in
 * words as well as in colour.
 */
export const SettingsRow = memo(function SettingsRow({
  active,
  index,
  onSelect,
  row,
  width,
}: SettingsRowProps) {
  const t = useTheme()
  const ink = useSelectionInk()
  const storeMarks = {
    fromConfigFile: useSettingsStore((s) => s.fromConfigFile.has(row.id)),
    touched: useSettingsStore((s) => s.touched.has(row.id)),
  }
  const { fromConfigFile, touched } = rowMarks(row, storeMarks)
  // A blank when neither applies, never nothing: a marker that comes and goes
  // would shift the label of every row it is missing from.
  let mark = ' '
  if (fromConfigFile) mark = CONFIG_FILE_MARK
  else if (touched) mark = TOUCHED_MARK

  const inner = Math.max(12, width - ROW_CHROME)
  const labelWidth = Math.max(10, Math.min(LABEL_MAX, inner - 12))

  let labelFg = row.kind === 'info' ? t.textMuted : t.text
  let markFg = fromConfigFile ? t.warning : t.secondary
  if (active) labelFg = markFg = ink

  return (
    <ListItem
      id={`setting-row-${row.id}`}
      active={active}
      index={index}
      onClickIndex={onSelect}
      leading={<text fg={markFg}>{mark}</text>}
      title={
        <box width={inner} flexDirection="row" flexShrink={0}>
          <box width={labelWidth} flexShrink={0}>
            <text fg={labelFg} wrapMode="none">
              {truncate(row.label, labelWidth - 1)}
            </text>
          </box>
          <RowValue row={row} fg={active ? ink : undefined} maxWidth={inner - labelWidth} />
        </box>
      }
    />
  )
})

import { memo } from 'react'

import type { SettingRow } from '../../../settings/types'

import { rowMarks } from '../../../settings/row-marks'
import { readRow, useSettingsStore } from '../../../settings/settings-store'
import { useAppStore } from '../../../state/app-store'
import { useTheme } from '../../theme'
import { truncate } from '../../truncate'
import { ListItem } from '../primitives/list-item'
import { Bar } from '../stats/shared'
import { RowValue } from './row-value'

/**
 * Where the value comes from, on the left, out of the value column's way. Both
 * are legended by the headline row at the top of the screen, which counts them.
 */
export const CONFIG_FILE_MARK = '*'
export const TOUCHED_MARK = '~'

/** The cursor, the mark, their spaces, and the row's own padding either side. */
const ROW_CHROME = 6
/** The column every value ends on, and the least the widest of them needs. */
const VALUE_WIDTH = 12
/**
 * Uncapped, unlike the stats bars, which stop at 32.
 *
 * That cap is there because those bars share a scale and get compared to each
 * other, and comparing two lengths gets harder as they grow. These do not: each
 * one is a position inside its own row's range, read on its own. So it runs to
 * the value column and the row has no gap in the middle of it.
 */
const BAR_MAX = Infinity
/**
 * Every label there is fits in this, so nothing on the screen is cropped when
 * the column is wide enough to give it — which is what the column layout is
 * sized around. (`Auto-rename minimum words` is the longest at 25.)
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
 * The gauge on a row that has a floor and a ceiling.
 *
 * A bar is honest here for the same reason it is honest on a quota and dishonest
 * on a headline number: `min` and `max` are a real scale, so the fraction means
 * something. It is measured from `min`, not from zero — a delay that runs 60s to
 * 3600s sitting at 60 is at the bottom of its range, not at 2% of it.
 */
function RangeGauge({
  row,
  width,
}: {
  row: Extract<SettingRow, { kind: 'number' }>
  width: number
}) {
  const t = useTheme()
  const values = useSettingsStore((s) => s.values)
  const value = useAppStore((s) => readRow(row, { state: s, values }))
  const span = row.max - row.min
  if (span <= 0) return null
  return (
    <Bar
      color={t.primary}
      max={span}
      segments={width}
      value={Math.max(0, (typeof value === 'number' ? value : row.min) - row.min)}
    />
  )
}

/**
 * What it is, what it is set to, where that sits in its range, and what it does
 * underneath. It can afford the second line because the screen shows one section
 * at a time — fifty rows in one scroll could not, which is what made the old
 * two-line row a wall rather than a paragraph.
 *
 * The same three-part geometry as a stats bar row: label on the left, the gauge
 * in the middle, the column's right edge on the right. Every value on the screen
 * therefore ends on one column, which is what makes a page of them read as a
 * page rather than as rows that happen to sit above each other.
 *
 * Both columns at full strength, unlike a stats row, which mutes its label. On
 * that screen the number is the content and the label only says which number it
 * is; here you are scanning the labels to find the one you came for.
 */
export const SettingsRow = memo(function SettingsRow({
  active,
  index,
  onSelect,
  row,
  width,
}: SettingsRowProps) {
  const t = useTheme()
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

  // The label gets first call on the column and the gauge takes what is left,
  // not the other way round: a bar two cells shorter still reads as the same
  // proportion, where `Transparent bac…` and `Transparent bak…` do not read as
  // different settings.
  const inner = Math.max(12, width - ROW_CHROME)
  const labelWidth = Math.max(10, Math.min(LABEL_MAX, inner - VALUE_WIDTH))
  const barWidth = Math.min(BAR_MAX, inner - labelWidth - VALUE_WIDTH - 1)

  return (
    <ListItem
      id={`setting-row-${row.id}`}
      active={active}
      index={index}
      onClickIndex={onSelect}
      leading={<text fg={fromConfigFile ? t.warning : t.secondary}>{mark}</text>}
      subtitle={
        row.description != null && row.description !== '' ? (
          <box width={inner}>
            <text fg={t.textMuted} selectable={false}>
              {row.description}
            </text>
          </box>
        ) : undefined
      }
      title={
        <box width={inner} flexDirection="row" flexShrink={0}>
          <box width={labelWidth} flexShrink={0}>
            <text fg={row.kind === 'info' ? t.textMuted : t.text} wrapMode="none">
              {truncate(row.label, labelWidth - 1)}
            </text>
          </box>
          {row.kind === 'number' && barWidth > 0 ? <RangeGauge row={row} width={barWidth} /> : null}
          {/* Grows into whatever the label and the gauge left, so the value ends
              on the column's edge whether or not the row has a gauge. */}
          <box flexGrow={1} flexDirection="row" justifyContent="flex-end">
            <RowValue
              row={row}
              maxWidth={inner - labelWidth - (barWidth > 0 && row.kind === 'number' ? barWidth : 0)}
            />
          </box>
        </box>
      }
    />
  )
})

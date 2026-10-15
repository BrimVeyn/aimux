import { memo } from 'react'

import type { SettingRow } from '../../../settings/types'

import { rowMarks } from '../../../settings/row-marks'
import { readRow, storedRow, useSettingsStore } from '../../../settings/settings-store'
import { useAppStore } from '../../../state/app-store'
import { useTheme } from '../../theme'
import { truncate } from '../../truncate'
import { describeValue } from './row-value'

/**
 * What the selected row does, and what it can be set to — said once, at the foot
 * of the screen, for the row you are on, instead of under every row at once.
 *
 * Fixed height whatever the row is: a footer that grows and shrinks moves the
 * list above it, and a list that shifts while you walk down it is unusable. The
 * keys are not here — the keybind overlay already lists them.
 */

/** Rows the description may wrap onto before it is cut. */
const DESCRIPTION_ROWS = 2

/** Where the value comes from and when it takes effect. */
function notesFor(row: SettingRow, fromConfigFile: boolean): string {
  if (fromConfigFile) return 'set in aimux.config.ts — comes back on restart'
  return storedRow(row)?.restart === true ? 'applies on restart' : ''
}

/**
 * The options of a select, spelled out with the current one lit. The row can
 * only show the one it is on, and stepping through the rest to find out what
 * they are is not reading, it is guessing.
 */
function OptionStrip({ row }: { row: Extract<SettingRow, { kind: 'select' }> }) {
  const t = useTheme()
  const values = useSettingsStore((s) => s.values)
  const current = useAppStore((s) => readRow(row, { state: s, values }))
  return (
    <box flexDirection="row" gap={1}>
      {row.options.map((option) => (
        <text
          key={String(option.value)}
          fg={option.value === current ? t.text : t.textMuted}
          selectable={false}
          wrapMode="none"
        >
          {option.value === current ? `[${option.label}]` : option.label}
        </text>
      ))}
    </box>
  )
}

/** What the second line says when the row is not one with options to list. */
function rangeOf(row: SettingRow): string {
  if (row.kind === 'number') return `${String(row.min)} – ${String(row.max)}`
  if (row.kind === 'toggle') return 'on · off'
  return ''
}

/**
 * The whole of a value the row could only show the start of. A command or a
 * path is the one kind of value that does not fit its column, and it is also
 * the one you most need to read before changing it.
 */
function FullValue({
  row,
}: {
  row: Extract<SettingRow, { kind: 'text' | 'keybind' | 'action' | 'info' }>
}) {
  const t = useTheme()
  const values = useSettingsStore((s) => s.values)
  const value = useAppStore((s) => readRow(row, { state: s, values }))
  return (
    <text fg={t.textMuted} selectable={false} wrapMode="none">
      {String(value)}
    </text>
  )
}

export const SettingsFooter = memo(function SettingsFooter({
  pad,
  row,
  width,
}: {
  pad: number
  row: SettingRow | null
  width: number
}) {
  const t = useTheme()
  const storeMarks = {
    fromConfigFile: useSettingsStore((s) => (row ? s.fromConfigFile.has(row.id) : false)),
    touched: useSettingsStore((s) => (row ? s.touched.has(row.id) : false)),
  }
  const { fromConfigFile, touched } = row ? rowMarks(row, storeMarks) : storeMarks
  const defaultValue = useSettingsStore((s) => (row ? s.defaults[row.id] : undefined))

  // Only once the row has been changed — `r` is otherwise a key you press to
  // find out what it does.
  const resetHint =
    row && touched && defaultValue !== undefined
      ? `default: ${describeValue(row, defaultValue)}`
      : null
  // The surface's own padding either side.
  const inner = Math.max(1, width - 4)
  const aside = [row ? notesFor(row, fromConfigFile) : '', resetHint ?? '']
    .filter((part) => part !== '')
    .join(' · ')

  return (
    <box flexDirection="column" flexShrink={0} paddingLeft={pad} paddingRight={pad}>
      {/* Its own surface, painted once: on the page it was one more paragraph
          under the list and the eye went past it. */}
      <box
        flexDirection="column"
        flexShrink={0}
        width={width}
        padding={1}
        paddingLeft={2}
        paddingRight={2}
        backgroundColor={t.backgroundPanel}
      >
        <box width={inner} height={DESCRIPTION_ROWS} flexShrink={0} overflow="hidden">
          <text fg={t.text} selectable={false}>
            {row?.description ?? ''}
          </text>
        </box>
        <box width={inner} height={1} flexDirection="row" flexShrink={0} overflow="hidden">
          <box flexGrow={1} flexShrink={1} overflow="hidden">
            {row?.kind === 'select' ? <OptionStrip row={row} /> : null}
            {row?.kind === 'text' || row?.kind === 'action' || row?.kind === 'info' ? (
              <FullValue row={row} />
            ) : null}
            {row?.kind === 'number' || row?.kind === 'toggle' ? (
              <text fg={t.textMuted} selectable={false} wrapMode="none">
                {rangeOf(row)}
              </text>
            ) : null}
          </box>
          {aside === '' ? null : (
            <text fg={fromConfigFile ? t.warning : t.textMuted} selectable={false} wrapMode="none">
              {`  ${truncate(aside, Math.max(0, inner - 12))}`}
            </text>
          )}
        </box>
      </box>
    </box>
  )
})

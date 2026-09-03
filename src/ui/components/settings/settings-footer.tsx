import { memo, useCallback } from 'react'

import type { SettingRow } from '../../../settings/types'

import { rowMarks } from '../../../settings/row-marks'
import { readRow, storedRow, useSettingsStore } from '../../../settings/settings-store'
import { useAppStore } from '../../../state/app-store'
import { dispatchGlobal } from '../../../state/dispatch-ref'
import { useTheme } from '../../theme'
import { truncate } from '../../truncate'
import { describeValue } from './row-value'

/**
 * Everything the rows used to carry on a second line of their own, moved to the
 * foot of the screen and shown for the selected row only.
 *
 * Three lines, always, whatever the row is: a footer that grows and shrinks
 * moves the list above it, and a list that shifts while you walk down it is the
 * thing this screen was rebuilt to stop doing.
 */

/**
 * `[key, what it does]`, so the keys can wear the theme and the prose cannot.
 *
 * Cut to what works on the row you are standing on: `←/→` does nothing to a
 * text field, and a hint for a key that does nothing is worse than no hint.
 */
function hintsFor(row: SettingRow | null): [string, string][] {
  const hints: [string, string][] = []
  if (row?.kind === 'number' || row?.kind === 'select' || row?.kind === 'toggle') {
    hints.push(['←/→', 'adjust'])
  }
  if (row != null && row.kind !== 'info') {
    hints.push(['↵', row.kind === 'number' || row.kind === 'text' ? 'type a value' : 'change'])
  }
  hints.push(['r', 'reset'], ['/', 'search'], ['} {', 'section'], ['esc', 'close'])
  return hints
}

/**
 * What the row itself does not say. Not its description — the row carries that
 * under its own label now — but where its value comes from and when it takes
 * effect, which belong to the row you are on rather than to the setting.
 */
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
function FullValue({ row }: { row: Extract<SettingRow, { kind: 'text' | 'action' | 'info' }> }) {
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

  const handleClose = useCallback(() => dispatchGlobal({ type: 'exit-settings' }), [])

  const notes = row ? notesFor(row, fromConfigFile) : ''
  // Only once the row has been changed — `r` is otherwise a key you press to
  // find out what it does.
  const resetHint =
    row && touched && defaultValue !== undefined
      ? `default: ${describeValue(row, defaultValue)}`
      : null

  return (
    <box flexDirection="column" flexShrink={0} paddingLeft={pad} paddingRight={pad}>
      {/* A blank row, not a rule: the footer is set off from the list by the gap,
          the same way the sidebar's is. */}
      <box height={1} flexShrink={0} />
      <box width={width} flexDirection="row" flexShrink={0}>
        <box flexGrow={1} flexShrink={1}>
          <text fg={t.textMuted} selectable={false} wrapMode="none">
            {truncate(notes, Math.max(0, width - (resetHint?.length ?? 0) - 2))}
          </text>
        </box>
        {resetHint != null ? (
          <text fg={t.textMuted} selectable={false} wrapMode="none">
            {resetHint}
          </text>
        ) : null}
      </box>
      <box height={1} flexShrink={0} overflow="hidden">
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
      {/* Clipped rather than squeezed: a row of hints allowed to shrink loses
          the spaces *inside* the words first, and `↵change  -/+step` is worse
          than the same line with its tail cut off on a narrow terminal. */}
      <box width={width} flexDirection="row" flexShrink={0} gap={2} overflow="hidden">
        {hintsFor(row).map(([key, what]) => (
          <box key={key} flexDirection="row" flexShrink={0}>
            <text
              fg={t.primary}
              selectable={false}
              wrapMode="none"
              onMouseDown={key === 'esc' ? handleClose : undefined}
            >
              {key}
            </text>
            <text fg={t.textMuted} selectable={false} wrapMode="none">
              {` ${what}`}
            </text>
          </box>
        ))}
      </box>
    </box>
  )
})

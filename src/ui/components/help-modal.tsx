import type { ModeId } from '@brimveyn/aimux-config'

import { useTerminalDimensions } from '@opentui/react'
import { useLayoutEffect, useMemo, useRef } from 'react'

import {
  collectHelpEntries,
  HELP_MODE_LABELS,
  type HelpEntry,
} from '../../input/keymap/help-entries'
import { dispatchGlobal } from '../../state/dispatch-ref'
import { useKeymap } from '../keymap-context'
import { theme } from '../theme'
import { uiTokens } from '../ui-tokens'
import { ModalFilterBar } from './modal-filter-bar'
import { ModalShell } from './modal-shell'

interface HelpModalProps {
  filter: string | null
  selectedIndex: number
  scope: ModeId | null
}

function matchesFilter(entry: HelpEntry, needle: string): boolean {
  if (!needle) return true
  const lower = needle.toLowerCase()
  return (
    (entry.description?.toLowerCase().includes(lower) ?? false) ||
    entry.modeLabel.toLowerCase().includes(lower) ||
    entry.keysDisplay.toLowerCase().includes(lower) ||
    (entry.group?.toLowerCase().includes(lower) ?? false)
  )
}

type Row =
  | { kind: 'header'; label: string }
  | { kind: 'entry'; entry: HelpEntry; entryIndex: number }

function buildRows(entries: HelpEntry[]): Row[] {
  const rows: Row[] = []
  let lastLabel: string | null = null
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
    const entry = entries[entryIndex]
    if (!entry) continue
    if (entry.modeLabel !== lastLabel) {
      rows.push({ kind: 'header', label: entry.modeLabel })
      lastLabel = entry.modeLabel
    }
    rows.push({ entry, entryIndex, kind: 'entry' })
  }
  return rows
}

const KEYS_COLUMN_WIDTH = 24
const VIEWPORT_HEIGHT_RATIO = 0.6
const MODAL_CHROME_ROWS = 6

function clampSelection(index: number, count: number): number {
  if (count === 0) return 0
  return Math.max(0, Math.min(count - 1, index))
}

/**
 * Pick a window start that (a) keeps the selected row on screen and
 * (b) only scrolls when the selection leaves the margin — avoids jumpy
 * recentering on every keypress.
 */
function computeWindowStart(
  prevStart: number,
  selectedRowIndex: number,
  total: number,
  windowSize: number
): number {
  if (total <= windowSize) return 0
  const margin = 1
  const maxStart = total - windowSize
  let start = Math.max(0, Math.min(maxStart, prevStart))
  const topThreshold = start + margin
  const bottomThreshold = start + windowSize - 1 - margin
  if (selectedRowIndex < topThreshold) {
    start = Math.max(0, selectedRowIndex - margin)
  } else if (selectedRowIndex > bottomThreshold) {
    start = Math.min(maxStart, selectedRowIndex - windowSize + 1 + margin)
  }
  return start
}

export function HelpModal({ filter, scope, selectedIndex }: HelpModalProps) {
  const config = useKeymap()
  const dimensions = useTerminalDimensions()
  const allEntries = useMemo(() => collectHelpEntries(config), [config])
  const scoped = useMemo(
    () => (scope ? allEntries.filter((e) => e.mode === scope) : allEntries),
    [allEntries, scope]
  )
  const filtered = useMemo(
    () => scoped.filter((e) => matchesFilter(e, filter ?? '')),
    [scoped, filter]
  )
  const title = useMemo(() => {
    if (!scope) return 'Keybindings'
    const label = HELP_MODE_LABELS.find((m) => m.modeId === scope)?.label ?? scope
    return `${label} — keybindings`
  }, [scope])
  const rows = useMemo(() => buildRows(filtered), [filtered])

  useLayoutEffect(() => {
    dispatchGlobal({ count: filtered.length, type: 'set-help-entry-count' })
  }, [filtered.length])

  const effectiveIndex = clampSelection(selectedIndex, filtered.length)
  const selectedRowIndex = Math.max(
    0,
    rows.findIndex((r) => r.kind === 'entry' && r.entryIndex === effectiveIndex)
  )
  const maxHeight = Math.max(6, Math.floor(dimensions.height * VIEWPORT_HEIGHT_RATIO))
  const listHeight = Math.max(1, maxHeight - MODAL_CHROME_ROWS)

  const prevStartRef = useRef(0)
  const prevFilterRef = useRef<string | null>(filter)
  // Reset scroll when filter changes; selection goes back to index 0.
  if (prevFilterRef.current !== filter) {
    prevFilterRef.current = filter
    prevStartRef.current = 0
  }
  const start = computeWindowStart(prevStartRef.current, selectedRowIndex, rows.length, listHeight)
  prevStartRef.current = start
  const visible = rows.slice(start, start + listHeight)

  return (
    <ModalShell
      title={title}
      keybindsModeId="modal.help"
      width={uiTokens.modalWidth.lg}
      footer={
        <box flexDirection="column" gap={0}>
          <text fg={theme.colors['editor.lineHighlightBackground']}>
            {filtered.length === 0
              ? ''
              : ` ${effectiveIndex + 1} / ${filtered.length}${filter ? '' : ' — type / to filter'}`}
          </text>
          <ModalFilterBar filter={filter} />
        </box>
      }
    >
      {filtered.length === 0 ? (
        <text fg={theme.colors['descriptionForeground']}>
          {filter ? 'No matching bindings.' : 'No bindings registered.'}
        </text>
      ) : (
        <box height={listHeight} flexDirection="column" overflow="hidden">
          {visible.map((row, i) => {
            const rowIndex = start + i
            if (row.kind === 'header') {
              return (
                <box key={`h-${rowIndex}`} paddingLeft={1} paddingTop={i === 0 ? 0 : 1}>
                  <text fg={theme.colors['editorWarning.foreground']} wrapMode="none">
                    <strong>{row.label}</strong>
                  </text>
                </box>
              )
            }
            const active = row.entryIndex === effectiveIndex
            const bg = active ? theme.colors['list.activeSelectionBackground'] : undefined
            return (
              <box
                key={`e-${rowIndex}`}
                flexDirection="row"
                paddingLeft={2}
                paddingRight={1}
                backgroundColor={bg}
              >
                <box width={KEYS_COLUMN_WIDTH} flexShrink={0}>
                  <text
                    fg={
                      active
                        ? theme.colors['textLink.foreground']
                        : theme.colors['terminal.ansiMagenta']
                    }
                    bg={bg}
                    wrapMode="none"
                  >
                    {row.entry.keysDisplay}
                  </text>
                </box>
                <box flexGrow={1} overflow="hidden">
                  <text
                    fg={
                      active
                        ? theme.colors['editor.foreground']
                        : theme.colors['descriptionForeground']
                    }
                    bg={bg}
                    wrapMode="none"
                  >
                    {row.entry.description ?? ''}
                  </text>
                </box>
              </box>
            )
          })}
        </box>
      )}
    </ModalShell>
  )
}

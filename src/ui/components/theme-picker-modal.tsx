import { useTerminalDimensions } from '@opentui/react'
import { useLayoutEffect, useMemo, useRef } from 'react'

import { dispatchGlobal } from '../../state/dispatch-ref'
import { filterThemeIds } from '../filter-themes'
import { theme } from '../theme'
import { type ThemeId, THEMES } from '../themes'
import { uiTokens } from '../ui-tokens'
import { ListItem } from './list-item'
import { ModalFilterBar } from './modal-filter-bar'
import { ModalShell } from './modal-shell'

interface ThemePickerModalProps {
  currentThemeId: ThemeId
  filter: string | null
  selectedIndex: number
}

const VIEWPORT_HEIGHT_RATIO = 0.6
const MODAL_CHROME_ROWS = 6

function clampSelection(index: number, count: number): number {
  if (count === 0) return 0
  return Math.max(0, Math.min(count - 1, index))
}

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

export function ThemePickerModal({ currentThemeId, filter, selectedIndex }: ThemePickerModalProps) {
  const dimensions = useTerminalDimensions()
  const filtered = useMemo(() => filterThemeIds(filter), [filter])

  useLayoutEffect(() => {
    dispatchGlobal({ count: filtered.length, type: 'set-theme-entry-count' })
  }, [filtered.length])

  const effectiveIndex = clampSelection(selectedIndex, filtered.length)
  const maxHeight = Math.max(6, Math.floor(dimensions.height * VIEWPORT_HEIGHT_RATIO))
  const listHeight = Math.max(1, maxHeight - MODAL_CHROME_ROWS)

  const prevStartRef = useRef(0)
  const prevFilterRef = useRef<string | null>(filter)
  if (prevFilterRef.current !== filter) {
    prevFilterRef.current = filter
    prevStartRef.current = 0
  }
  const start = computeWindowStart(
    prevStartRef.current,
    effectiveIndex,
    filtered.length,
    listHeight
  )
  prevStartRef.current = start
  const visible = filtered.slice(start, start + listHeight)

  return (
    <ModalShell
      title="Select theme"
      keybindsModeId="modal.theme-picker"
      width={uiTokens.modalWidth.md}
      listGap={0}
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
          {filter ? 'No matching themes.' : 'No themes available.'}
        </text>
      ) : (
        <box height={listHeight} flexDirection="column" overflow="hidden">
          {visible.map((id, i) => {
            const rowIndex = start + i
            const entry = THEMES[id]
            if (!entry) return null
            const active = rowIndex === effectiveIndex
            const isCurrent = id === currentThemeId
            return (
              <ListItem
                key={id}
                active={active}
                title={
                  <text
                    fg={
                      active
                        ? theme.colors['editor.foreground']
                        : theme.colors['descriptionForeground']
                    }
                  >
                    {entry.name}
                  </text>
                }
                trailing={
                  isCurrent ? (
                    <text fg={theme.colors['textLink.foreground']}>current</text>
                  ) : undefined
                }
              />
            )
          })}
        </box>
      )}
    </ModalShell>
  )
}

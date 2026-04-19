import type { ScrollBoxRenderable } from '@opentui/core'

import { useTerminalDimensions } from '@opentui/react'
import { useLayoutEffect, useMemo, useRef } from 'react'

import { dispatchGlobal, runSideEffectGlobal } from '../../state/dispatch-ref'
import { filterThemeIds } from '../filter-themes'
import { useTheme } from '../theme'
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

export function ThemePickerModal({ currentThemeId, filter, selectedIndex }: ThemePickerModalProps) {
  const theme = useTheme()
  const dimensions = useTerminalDimensions()
  const filtered = useMemo(() => filterThemeIds(filter), [filter])

  useLayoutEffect(() => {
    dispatchGlobal({ count: filtered.length, type: 'set-theme-entry-count' })
  }, [filtered.length])

  const effectiveIndex = clampSelection(selectedIndex, filtered.length)
  const maxHeight = Math.max(6, Math.floor(dimensions.height * VIEWPORT_HEIGHT_RATIO))
  const listHeight = Math.max(1, maxHeight - MODAL_CHROME_ROWS)

  const scrollboxRef = useRef<ScrollBoxRenderable | null>(null)
  const isScrollingRef = useRef(false)
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useLayoutEffect(() => {
    if (!scrollboxRef.current) return
    isScrollingRef.current = true
    scrollboxRef.current.scrollChildIntoView(`theme-item-${effectiveIndex}`)
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = setTimeout(() => {
      isScrollingRef.current = false
      scrollTimerRef.current = null
    }, 10)
  }, [effectiveIndex])

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
        <scrollbox
          ref={scrollboxRef}
          scrollY
          height={listHeight}
          contentOptions={{ flexDirection: 'column' }}
          onMouseScroll={() => {
            isScrollingRef.current = true
            if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
            scrollTimerRef.current = setTimeout(() => {
              isScrollingRef.current = false
              scrollTimerRef.current = null
            }, 100)
          }}
        >
          {filtered.map((id, rowIndex) => {
            const entry = THEMES[id]
            if (!entry) return null
            const active = rowIndex === effectiveIndex
            const isCurrent = id === currentThemeId
            return (
              <ListItem
                key={id}
                id={`theme-item-${rowIndex}`}
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
                onHover={() => {
                  if (isScrollingRef.current) return
                  dispatchGlobal({ index: rowIndex, type: 'set-modal-selection-index' })
                }}
                onClick={() => {
                  dispatchGlobal({ type: 'close-modal' })
                  runSideEffectGlobal({ action: 'confirm', type: 'apply-theme' })
                }}
              />
            )
          })}
        </scrollbox>
      )}
    </ModalShell>
  )
}

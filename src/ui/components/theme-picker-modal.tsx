import { useLayoutEffect, useMemo } from 'react'

import { dispatchGlobal, runSideEffectGlobal } from '../../state/dispatch-ref'
import { filterThemeIds } from '../filter-themes'
import { useTheme } from '../theme'
import { type ThemeId, THEMES } from '../themes'
import { uiTokens } from '../ui-tokens'
import { Picker, type PickerItem } from './picker'

interface ThemePickerModalProps {
  currentThemeId: ThemeId
  filter: string | null
  selectedIndex: number
  cursorPos?: number
}

function clampSelection(index: number, count: number): number {
  if (count === 0) return 0
  return Math.max(0, Math.min(count - 1, index))
}

export function ThemePickerModal({
  currentThemeId,
  cursorPos,
  filter,
  selectedIndex,
}: ThemePickerModalProps) {
  const theme = useTheme()
  const filtered = useMemo(() => filterThemeIds(filter), [filter])

  useLayoutEffect(() => {
    dispatchGlobal({ count: filtered.length, type: 'set-theme-entry-count' })
  }, [filtered.length])

  const effectiveIndex = clampSelection(selectedIndex, filtered.length)

  const items: PickerItem[] = filtered.flatMap((id, rowIndex) => {
    const entry = THEMES[id]
    if (!entry) return []
    const active = rowIndex === effectiveIndex
    const isCurrent = id === currentThemeId
    return [
      {
        key: id,
        onClick: () => {
          dispatchGlobal({ type: 'close-modal' })
          runSideEffectGlobal({ action: 'confirm', type: 'apply-theme' })
        },
        title: (
          <text
            fg={active ? theme.colors['editor.foreground'] : theme.colors['descriptionForeground']}
          >
            {entry.name}
          </text>
        ),
        trailing: isCurrent ? (
          <text fg={theme.colors['textLink.foreground']}>current</text>
        ) : undefined,
      },
    ]
  })

  return (
    <Picker
      title="Select theme"
      keybindsModeId="modal.theme-picker.filtering"
      width={uiTokens.modalWidth.md}
      listGap={0}
      filter={filter}
      cursorPos={cursorPos}
      footer={
        <text fg={theme.colors['editor.lineHighlightBackground']}>
          {filtered.length === 0 ? '' : ` ${effectiveIndex + 1} / ${filtered.length}`}
        </text>
      }
      items={items}
      selectedIndex={effectiveIndex}
      emptyState={
        <text fg={theme.colors['descriptionForeground']}>
          {filter ? 'No matching themes.' : 'No themes available.'}
        </text>
      }
      onHover={(index) => dispatchGlobal({ index, type: 'set-modal-selection-index' })}
    />
  )
}

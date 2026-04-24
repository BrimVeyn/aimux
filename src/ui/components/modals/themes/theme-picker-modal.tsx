import { useLayoutEffect, useMemo } from 'react'

import { dispatchGlobal, runSideEffectGlobal } from '../../../../state/dispatch-ref'
import { filterThemeIds } from '../../../filter-themes'
import { usePalette, useTheme, useTransparent } from '../../../theme'
import { type ThemeId, THEMES } from '../../../themes'
import { uiTokens } from '../../../ui-tokens'
import { Picker, type PickerItem } from '../shared/picker'

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
  const t = useTheme()
  const p = usePalette()
  const transparent = useTransparent()
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
        title: <text fg={active ? t['text-base'] : t['text-weak']}>{entry.displayName}</text>,
        trailing: isCurrent ? <text fg={p.primary}>current</text> : undefined,
      },
    ]
  })

  return (
    <Picker
      title="Select theme"
      keybindsModeId="modal.theme-picker.filtering"
      width={uiTokens.modalWidth.md}
      filter={filter}
      cursorPos={cursorPos}
      footer={
        <box flexDirection="column" gap={0}>
          <text fg={t['text-weaker']}>
            {filtered.length === 0 ? '' : ` ${effectiveIndex + 1} / ${filtered.length}`}
          </text>
          <text fg={t['text-weak']}>{` transparent: ${transparent ? 'on' : 'off'} (ctrl-t)`}</text>
        </box>
      }
      items={items}
      selectedIndex={effectiveIndex}
      emptyState={<text fg={t['text-weak']}>No themes available.</text>}
      onHover={(index) => dispatchGlobal({ index, type: 'set-modal-selection-index' })}
    />
  )
}

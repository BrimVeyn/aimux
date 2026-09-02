import { useCallback, useLayoutEffect, useMemo } from 'react'

import type { ThemeId } from '../../../themes'

import { dispatchGlobal, runSideEffectGlobal } from '../../../../state/dispatch-ref'
import { filterThemeIds, themeDisplayName } from '../../../filter-themes'
import { useSelectionInk } from '../../../selection-ink'
import { useMode, useTheme, useTransparent } from '../../../theme'
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
  const ink = useSelectionInk()
  const transparent = useTransparent()
  const mode = useMode()
  const filtered = useMemo(() => filterThemeIds(filter), [filter])

  useLayoutEffect(() => {
    dispatchGlobal({ count: filtered.length, type: 'set-theme-entry-count' })
  }, [filtered.length])

  const effectiveIndex = clampSelection(selectedIndex, filtered.length)

  const items = useMemo<PickerItem[]>(
    () =>
      filtered.map((id, rowIndex) => {
        const active = rowIndex === effectiveIndex
        const isCurrent = id === currentThemeId
        return {
          key: id,
          onClick: () => {
            dispatchGlobal({ type: 'close-modal' })
            runSideEffectGlobal({ action: 'confirm', type: 'apply-theme' })
          },
          title: <text fg={active ? ink : t.textMuted}>{themeDisplayName(id)}</text>,
          trailing: isCurrent ? <text fg={active ? ink : t.primary}>current</text> : undefined,
        }
      }),
    [currentThemeId, effectiveIndex, filtered, ink, t]
  )

  const handleHover = useCallback(
    (index: number) => dispatchGlobal({ index, type: 'set-modal-selection-index' }),
    []
  )

  return (
    <Picker
      title="Select theme"
      keybindsModeId="modal.theme-picker.filtering"
      width={uiTokens.modalWidth.md}
      filter={filter}
      cursorPos={cursorPos}
      footer={
        <text fg={t.textMuted}>
          {[
            filtered.length === 0 ? '' : `${effectiveIndex + 1}/${filtered.length}`,
            `transparent ${transparent ? 'on' : 'off'} (ctrl-t)`,
            `mode ${mode} (ctrl-l)`,
          ]
            .filter((part) => part !== '')
            .join(' · ')}
        </text>
      }
      items={items}
      selectedIndex={effectiveIndex}
      emptyState={<text fg={t.textMuted}>No themes available.</text>}
      onHover={handleHover}
    />
  )
}

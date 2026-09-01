import { useCallback, useMemo } from 'react'

import { filterSettingRows } from '../../../../settings/search'
import { useAppStore } from '../../../../state/app-store'
import { dispatchGlobal, runSideEffectGlobal } from '../../../../state/dispatch-ref'
import { useTheme } from '../../../theme'
import { uiTokens } from '../../../ui-tokens'
import { RowValue } from '../../settings/row-value'
import { Picker, type PickerItem } from '../shared/picker'

interface SettingsSearchModalProps {
  filter: string | null
  selectedIndex: number
  cursorPos?: number
}

/**
 * Every setting in one list, grouped by section and laid out the way the screen
 * lays them out — label and value on one line, what it does underneath. A result
 * you cannot read the current value of is a result you have to go and check.
 *
 * The filter is the one `getModalOptionCount` counts with, so the list and the
 * cursor moving through it never disagree.
 */
export function SettingsSearchModal({
  cursorPos,
  filter,
  selectedIndex,
}: SettingsSearchModalProps) {
  const t = useTheme()
  const projects = useAppStore((s) => s.projects)
  const hits = useMemo(() => filterSettingRows(projects, filter), [projects, filter])

  const items = useMemo<PickerItem[]>(
    () =>
      hits.map((hit) => ({
        group: hit.sectionLabel,
        key: hit.row.id,
        // Acts on the selection, which the hover just set — the same two-step
        // every other picker's rows use.
        onClick: () => runSideEffectGlobal({ type: 'confirm-settings-search' }),
        subtitle:
          hit.row.description != null && hit.row.description !== '' ? (
            <text fg={t.textMuted}>{hit.row.description}</text>
          ) : undefined,
        title: <text fg={t.text}>{hit.row.label}</text>,
        trailing: <RowValue row={hit.row} />,
      })),
    [hits, t]
  )

  const handleHover = useCallback(
    (index: number) => dispatchGlobal({ index, type: 'set-modal-selection-index' }),
    []
  )

  return (
    <Picker
      title="Search settings"
      keybindsModeId="modal.settings-search.filtering"
      width={uiTokens.modalWidth.xl}
      filter={filter}
      cursorPos={cursorPos}
      items={items}
      selectedIndex={selectedIndex}
      emptyState={<text fg={t.textMuted}>No setting matches.</text>}
      onHover={handleHover}
    />
  )
}

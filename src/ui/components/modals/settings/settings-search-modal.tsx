import { useCallback, useMemo } from 'react'

import { filterSettingRows } from '../../../../settings/search'
import { useAppStore } from '../../../../state/app-store'
import { dispatchGlobal } from '../../../../state/dispatch-ref'
import { useTheme } from '../../../theme'
import { uiTokens } from '../../../ui-tokens'
import { Picker, type PickerItem } from '../shared/picker'

interface SettingsSearchModalProps {
  filter: string | null
  selectedIndex: number
  cursorPos?: number
}

/**
 * Every setting in one list, grouped by section. The same filter the reducer
 * counts with, so the cursor and the list never disagree.
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
        title: <text wrapMode="none">{hit.row.label}</text>,
        trailing: (
          <text fg={t.textMuted} wrapMode="none">
            {hit.row.description ?? ''}
          </text>
        ),
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
      width={uiTokens.modalWidth.lg}
      filter={filter}
      cursorPos={cursorPos}
      items={items}
      selectedIndex={selectedIndex}
      emptyState={<text fg={t.textMuted}>No setting matches.</text>}
      onHover={handleHover}
    />
  )
}

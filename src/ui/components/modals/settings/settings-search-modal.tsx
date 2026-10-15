import { useCallback, useMemo } from 'react'

import { filterSettingRows } from '../../../../settings/search'
import { useAppStore } from '../../../../state/app-store'
import { dispatchGlobal, runSideEffectGlobal } from '../../../../state/dispatch-ref'
import { useSelectionInk } from '../../../selection-ink'
import { useTheme } from '../../../theme'
import { uiTokens } from '../../../ui-tokens'
import { RowValue } from '../../settings/row-value'
import { LABEL_MAX } from '../../settings/settings-row'
import { Picker, type PickerItem } from '../shared/picker'

interface SettingsSearchModalProps {
  filter: string | null
  selectedIndex: number
  cursorPos?: number
}

/** Rows the description may wrap onto before it is cut. */
const DESCRIPTION_ROWS = 2

/**
 * Every setting in one list, grouped by section and laid out the way the screen
 * lays them out — label and value on one line, what the selected one does in a
 * box under the list. A result you cannot read the current value of is a result
 * you have to go and check.
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
  const ink = useSelectionInk()
  const projects = useAppStore((s) => s.projects)
  const hits = useMemo(() => filterSettingRows(projects, filter), [projects, filter])

  const items = useMemo<PickerItem[]>(
    () =>
      hits.map((hit, index) => {
        const active = index === selectedIndex
        return {
          group: hit.sectionLabel,
          key: hit.row.id,
          // Acts on the selection, which the hover just set — the same two-step
          // every other picker's rows use.
          onClick: () => runSideEffectGlobal({ type: 'confirm-settings-search' }),
          title: (
            <box flexDirection="row">
              <box width={LABEL_MAX} flexShrink={0}>
                <text fg={active ? ink : t.text} wrapMode="none">
                  {hit.row.label}
                </text>
              </box>
              <RowValue fg={active ? ink : undefined} row={hit.row} />
            </box>
          ),
        }
      }),
    [hits, ink, selectedIndex, t]
  )

  const description = hits[selectedIndex]?.row.description ?? ''

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
      footer={
        // Its own surface — element, since the modal is already panel — for the
        // same reason the screen's footer has one: plain text under a list is read past.
        <box
          height={DESCRIPTION_ROWS + 2}
          padding={1}
          paddingLeft={2}
          paddingRight={2}
          overflow="hidden"
          backgroundColor={t.backgroundElement}
        >
          <text fg={t.text} selectable={false}>
            {description}
          </text>
        </box>
      }
      onHover={handleHover}
    />
  )
}

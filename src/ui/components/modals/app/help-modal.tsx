import type { ModeId } from '@brimveyn/aimux-config'

import { useLayoutEffect, useMemo } from 'react'

import { collectHelpEntries, HELP_MODE_LABELS } from '../../../../input/keymap/help-entries'
import { dispatchGlobal } from '../../../../state/dispatch-ref'
import { useKeymap } from '../../../keymap-context'
import { useTheme } from '../../../theme'
import { uiTokens } from '../../../ui-tokens'
import { Picker, type PickerItem } from '../shared/picker'

interface HelpModalProps {
  filter: string | null
  selectedIndex: number
  scope: ModeId | null
  cursorPos?: number
}

function matchesFilter(needle: string, ...fields: (string | undefined)[]): boolean {
  if (!needle) return true
  const lower = needle.toLowerCase()
  return fields.some((f) => f?.toLowerCase().includes(lower) === true)
}

export function HelpModal({ cursorPos, filter, scope, selectedIndex }: HelpModalProps) {
  const t = useTheme()
  const config = useKeymap()
  const allEntries = useMemo(() => collectHelpEntries(config), [config])
  const scoped = useMemo(
    () => (scope ? allEntries.filter((e) => e.mode === scope) : allEntries),
    [allEntries, scope]
  )
  const filtered = useMemo(
    () =>
      scoped.filter((e) =>
        matchesFilter(filter ?? '', e.description, e.modeLabel, e.keysDisplay, e.group)
      ),
    [scoped, filter]
  )

  const title = useMemo(() => {
    if (!scope) return 'Keybindings'
    const label = HELP_MODE_LABELS.find((m) => m.modeId === scope)?.label ?? scope
    return `${label} — keybindings`
  }, [scope])

  useLayoutEffect(() => {
    dispatchGlobal({ count: filtered.length, type: 'set-help-entry-count' })
  }, [filtered.length])

  const items: PickerItem[] = filtered.map((entry, index) => {
    return {
      group: entry.modeLabel,
      key: `${entry.mode}::${entry.keysDisplay}::${entry.description ?? ''}::${index}`,
      title: (
        <text fg={t.textMuted} wrapMode="none">
          {entry.description ?? ''}
        </text>
      ),
      trailing: (
        <text fg={t.textMuted} wrapMode="none">
          {entry.keysDisplay}
        </text>
      ),
    }
  })

  return (
    <Picker
      title={title}
      keybindsModeId="modal.help.filtering"
      width={uiTokens.modalWidth.lg}
      filter={filter}
      cursorPos={cursorPos}
      items={items}
      selectedIndex={selectedIndex}
      emptyState={
        <text fg={t.textMuted}>
          {filter != null && filter !== '' ? 'No matching bindings.' : 'No bindings registered.'}
        </text>
      }
      onHover={(index) => dispatchGlobal({ index, type: 'set-modal-selection-index' })}
    />
  )
}

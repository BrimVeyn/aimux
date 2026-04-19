import { getAllAssistantOptions } from '../../pty/command-registry'
import { dispatchGlobal, runSideEffectGlobal } from '../../state/dispatch-ref'
import { filterAssistants } from '../../state/selectors'
import { useTheme } from '../theme'
import { uiTokens } from '../ui-tokens'
import { Picker, type PickerItem } from './picker'

interface NewTabModalProps {
  selectedIndex: number
  customCommands: Record<string, string>
  filter: string | null
  cursorPos?: number
}

export function NewTabModal({
  cursorPos,
  customCommands,
  filter,
  selectedIndex,
}: NewTabModalProps) {
  const theme = useTheme()
  const options = getAllAssistantOptions(customCommands)
  const filtered = filterAssistants(options, filter)

  const items: PickerItem[] = filtered.map((option, index) => {
    const active = index === selectedIndex
    const customCmd = customCommands[option.id]
    return {
      key: option.id,
      onClick: () => runSideEffectGlobal({ type: 'launch-selected-assistant' }),
      subtitle: (
        <box flexDirection="column">
          <text fg={theme.colors['descriptionForeground']}>{option.description}</text>
          {customCmd ? <text fg={theme.colors['textLink.foreground']}>{customCmd}</text> : null}
        </box>
      ),
      title: (
        <text
          fg={active ? theme.colors['editor.foreground'] : theme.colors['descriptionForeground']}
        >
          {option.label}
        </text>
      ),
    }
  })

  return (
    <Picker
      title="New assistant tab"
      keybindsModeId="modal.new-tab.command-edit"
      width={uiTokens.modalWidth.md}
      gap={1}
      filter={filter}
      cursorPos={cursorPos}
      items={items}
      selectedIndex={selectedIndex}
      emptyState={<text fg={theme.colors['descriptionForeground']}>No matching assistants.</text>}
      onHover={(index) => dispatchGlobal({ index, type: 'set-modal-selection-index' })}
    />
  )
}

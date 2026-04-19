import type { AssistantId } from '../../state/types'

import { getAllAssistantOptions, getAssistantOption } from '../../pty/command-registry'
import { dispatchGlobal, runSideEffectGlobal } from '../../state/dispatch-ref'
import { filterAssistants } from '../../state/selectors'
import { useTheme } from '../theme'
import { uiTokens } from '../ui-tokens'
import { InputField } from './input-field'
import { ModalShell } from './modal-shell'
import { Picker, type PickerItem } from './picker'

interface NewTabModalProps {
  selectedIndex: number
  customCommands: Record<string, string>
  filter: string | null
  cursorPos?: number
  editingCommand: AssistantId | null
  editBuffer: string
}

export function NewTabModal({
  cursorPos,
  customCommands,
  editBuffer,
  editingCommand,
  filter,
  selectedIndex,
}: NewTabModalProps) {
  const theme = useTheme()

  if (editingCommand !== null) {
    const option =
      getAllAssistantOptions(customCommands).find((o) => o.id === editingCommand) ??
      getAssistantOption(0)
    return (
      <ModalShell
        title={`Edit command — ${option.label}`}
        keybindsModeId="modal.new-tab.editing-command"
        width={uiTokens.modalWidth.md}
      >
        <box flexDirection="column">
          <text fg={theme.colors['descriptionForeground']}>
            Custom command (blank to reset to default: {option.command})
          </text>
          <InputField
            active
            value={editBuffer}
            cursorPos={cursorPos}
            placeholder={option.command}
          />
        </box>
      </ModalShell>
    )
  }

  const options = getAllAssistantOptions(customCommands)
  const filtered = filterAssistants(options, filter)

  const items: PickerItem[] = filtered.map((option, index) => {
    const active = index === selectedIndex
    const customCmd = customCommands[option.id]
    return {
      key: option.id,
      onClick: () => runSideEffectGlobal({ type: 'launch-selected-assistant' }),
      onEdit: () => dispatchGlobal({ assistantId: option.id, type: 'open-edit-custom-command' }),
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

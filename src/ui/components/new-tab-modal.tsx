import { getAllAssistantOptions } from '../../pty/command-registry'
import { useModalHelp } from '../keymap-context'
import { theme } from '../theme'
import { uiTokens } from '../ui-tokens'
import { InputField } from './input-field'
import { ListItem } from './list-item'
import { ModalShell } from './modal-shell'

interface NewTabModalProps {
  selectedIndex: number
  customCommands: Record<string, string>
  editBuffer: string | null
}

export function NewTabModal({ customCommands, editBuffer, selectedIndex }: NewTabModalProps) {
  const options = getAllAssistantOptions(customCommands)
  const selectedOption = options[selectedIndex]
  const editingHelp = useModalHelp('modal.new-tab.command-edit')
  const browsingHelp = useModalHelp('modal.new-tab')
  const help =
    editBuffer !== null
      ? `Editing command for ${selectedOption?.label}. ${editingHelp}`
      : browsingHelp

  return (
    <ModalShell title="New assistant tab" help={help} width={uiTokens.modalWidth.md}>
      {editBuffer !== null ? (
        <InputField active value={editBuffer} />
      ) : (
        options.map((option, index) => {
          const active = index === selectedIndex
          const customCmd = customCommands[option.id]

          return (
            <ListItem
              key={option.id}
              active={active}
              title={<text fg={active ? theme.text : theme.textMuted}>{option.label}</text>}
              subtitle={
                <box flexDirection="column">
                  <text fg={theme.textMuted}>{option.description}</text>
                  {customCmd ? <text fg={theme.accent}>{customCmd}</text> : null}
                </box>
              }
            />
          )
        })
      )}
    </ModalShell>
  )
}

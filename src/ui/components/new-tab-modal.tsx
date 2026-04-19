import { getAllAssistantOptions } from '../../pty/command-registry'
import { dispatchGlobal, runSideEffectGlobal } from '../../state/dispatch-ref'
import { useTheme } from '../theme'
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
  const theme = useTheme()
  const options = getAllAssistantOptions(customCommands)
  const selectedOption = options[selectedIndex]
  const isEditing = editBuffer !== null

  return (
    <ModalShell
      title="New assistant tab"
      subtitle={isEditing ? `Editing command for ${selectedOption?.label}` : undefined}
      keybindsModeId={isEditing ? 'modal.new-tab.command-edit' : 'modal.new-tab'}
      width={uiTokens.modalWidth.md}
    >
      {isEditing ? (
        <InputField active value={editBuffer ?? ''} />
      ) : (
        <box flexDirection="column" gap={1}>
          {options.map((option, index) => {
            const active = index === selectedIndex
            const customCmd = customCommands[option.id]

            return (
              <ListItem
                key={option.id}
                active={active}
                title={
                  <text
                    fg={
                      active
                        ? theme.colors['editor.foreground']
                        : theme.colors['descriptionForeground']
                    }
                  >
                    {option.label}
                  </text>
                }
                subtitle={
                  <box flexDirection="column">
                    <text fg={theme.colors['descriptionForeground']}>{option.description}</text>
                    {customCmd ? (
                      <text fg={theme.colors['textLink.foreground']}>{customCmd}</text>
                    ) : null}
                  </box>
                }
                onHover={() => dispatchGlobal({ index, type: 'set-modal-selection-index' })}
                onClick={() => runSideEffectGlobal({ type: 'launch-selected-assistant' })}
              />
            )
          })}
        </box>
      )}
    </ModalShell>
  )
}

import type { AssistantId } from '../../../../state/types'

import { getAllAssistantOptions, getAssistantOption } from '../../../../pty/command-registry'
import { dispatchGlobal, runSideEffectGlobal } from '../../../../state/dispatch-ref'
import { filterAssistants } from '../../../../state/selectors'
import { usePalette, useTheme } from '../../../theme'
import { uiTokens } from '../../../ui-tokens'
import { Form, TextField } from '../shared/form'
import { Picker, type PickerItem } from '../shared/picker'

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
  const t = useTheme()
  const p = usePalette()

  if (editingCommand !== null) {
    const option =
      getAllAssistantOptions(customCommands).find((o) => o.id === editingCommand) ??
      getAssistantOption(0)
    return (
      <Form
        title={`Edit command — ${option.label}`}
        keybindsModeId="modal.new-tab.editing-command"
        width={uiTokens.modalWidth.md}
      >
        <TextField
          active
          description={<>blank to reset to default: {option.command}</>}
          value={editBuffer}
          cursorPos={cursorPos}
          placeholder={option.command}
        />
      </Form>
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
          <text fg={t['text-weak']}>{option.description}</text>
          {customCmd ? <text fg={p.primary}>{customCmd}</text> : null}
        </box>
      ),
      title: <text fg={active ? t['text-base'] : t['text-weak']}>{option.label}</text>,
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
      emptyState={<text fg={t['text-weak']}>No matching assistants.</text>}
      onHover={(index) => dispatchGlobal({ index, type: 'set-modal-selection-index' })}
    />
  )
}

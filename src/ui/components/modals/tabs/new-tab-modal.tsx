import { useCallback, useMemo } from 'react'

import type { AssistantId } from '../../../../state/types'

import { getAllAssistantOptions, getAssistantOption } from '../../../../pty/command-registry'
import { dispatchGlobal, runSideEffectGlobal } from '../../../../state/dispatch-ref'
import { filterAssistants } from '../../../../state/selectors'
import { useTheme } from '../../../theme'
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
  const options = useMemo(() => getAllAssistantOptions(customCommands), [customCommands])
  const filtered = useMemo(() => filterAssistants(options, filter), [filter, options])

  const handleHover = useCallback(
    (index: number) => dispatchGlobal({ index, type: 'set-modal-selection-index' }),
    []
  )

  const items = useMemo<PickerItem[]>(
    () =>
      filtered.map((option, index) => {
        const active = index === selectedIndex
        const customCmd = customCommands[option.id]
        return {
          key: option.id,
          onClick: () => {
            dispatchGlobal({ index, type: 'set-modal-selection-index' })
            runSideEffectGlobal({ type: 'launch-selected-assistant' })
          },
          onEdit: () =>
            dispatchGlobal({ assistantId: option.id, type: 'open-edit-custom-command' }),
          subtitle: (
            <box flexDirection="column">
              <text fg={t.textMuted}>{option.description}</text>
              {customCmd != null && customCmd !== '' ? (
                <text fg={t.primary}>{customCmd}</text>
              ) : null}
            </box>
          ),
          title: <text fg={active ? t.text : t.textMuted}>{option.label}</text>,
        }
      }),
    [customCommands, filtered, selectedIndex, t]
  )

  if (editingCommand !== null) {
    const option = options.find((o) => o.id === editingCommand) ?? getAssistantOption(0)
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

  return (
    <Picker
      title="New tab: choose assistant"
      keybindsModeId="modal.new-tab.command-edit"
      width={uiTokens.modalWidth.md}
      gap={1}
      filter={filter}
      cursorPos={cursorPos}
      items={items}
      selectedIndex={selectedIndex}
      emptyState={<text fg={t.textMuted}>No matching assistants.</text>}
      onHover={handleHover}
      footer={<text fg={t.textMuted}>Enter launches in the active worktree</text>}
    />
  )
}

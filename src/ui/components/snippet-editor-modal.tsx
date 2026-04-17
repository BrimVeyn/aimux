import { useModalHelp } from '../keymap-context'
import { theme } from '../theme'
import { uiTokens } from '../ui-tokens'
import { InputField } from './input-field'
import { ModalShell } from './modal-shell'

interface SnippetEditorModalProps {
  activeField: 'name' | 'content'
  snippetName: string
  snippetContent: string
  isEditing: boolean
}

export function SnippetEditorModal({
  activeField,
  isEditing,
  snippetContent,
  snippetName,
}: SnippetEditorModalProps) {
  const nameActive = activeField === 'name'
  const contentActive = activeField === 'content'
  const help = useModalHelp('modal.snippet-editor')

  return (
    <ModalShell
      title={isEditing ? 'Edit snippet' : 'Create snippet'}
      help={help}
      width={uiTokens.modalWidth.xl}
    >
      <box flexDirection="column">
        <text fg={nameActive ? theme.text : theme.textMuted}>Name</text>
        <InputField active={nameActive} value={snippetName} />
      </box>

      <box flexDirection="column">
        <text fg={contentActive ? theme.text : theme.textMuted}>Content</text>
        <InputField active={contentActive} value={snippetContent} />
      </box>
    </ModalShell>
  )
}

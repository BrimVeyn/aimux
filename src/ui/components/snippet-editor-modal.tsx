import { useTokens } from '../theme'
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
  const t = useTokens()
  const nameActive = activeField === 'name'
  const contentActive = activeField === 'content'

  return (
    <ModalShell
      title={isEditing ? 'Edit snippet' : 'Create snippet'}
      keybindsModeId="modal.snippet-editor"
      width={uiTokens.modalWidth.xl}
    >
      <box flexDirection="column">
        <text fg={nameActive ? t.palette.ink : t.muted}>Name</text>
        <InputField active={nameActive} value={snippetName} />
      </box>

      <box flexDirection="column">
        <text fg={contentActive ? t.palette.ink : t.muted}>Content</text>
        <InputField active={contentActive} value={snippetContent} />
      </box>
    </ModalShell>
  )
}

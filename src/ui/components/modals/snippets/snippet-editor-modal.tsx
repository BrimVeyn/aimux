import { uiTokens } from '../../../ui-tokens'
import { Form, TextField } from '../shared/form'

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

  return (
    <Form
      title={isEditing ? 'Edit snippet' : 'Create snippet'}
      keybindsModeId="modal.snippet-editor"
      width={uiTokens.modalWidth.xl}
    >
      <TextField active={nameActive} label="Name" value={snippetName} />
      <TextField active={contentActive} label="Content" value={snippetContent} />
    </Form>
  )
}

import { uiTokens } from '../../../ui-tokens'
import { Form, TextField } from '../shared/form'

interface SnippetEditorModalProps {
  activeField: 'name' | 'trigger' | 'content'
  snippetName: string
  snippetTrigger: string
  snippetContent: string
  isEditing: boolean
}

export function SnippetEditorModal({
  activeField,
  isEditing,
  snippetContent,
  snippetName,
  snippetTrigger,
}: SnippetEditorModalProps) {
  return (
    <Form
      title={isEditing ? 'Edit snippet' : 'Create snippet'}
      keybindsModeId="modal.snippet-editor"
      width={uiTokens.modalWidth.xl}
    >
      <TextField active={activeField === 'name'} label="Name" value={snippetName} />
      <TextField
        active={activeField === 'trigger'}
        label="Trigger (optional)"
        value={snippetTrigger}
      />
      <TextField active={activeField === 'content'} label="Content" value={snippetContent} />
    </Form>
  )
}

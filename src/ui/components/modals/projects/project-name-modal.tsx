import { uiTokens } from '../../../ui-tokens'
import { Form, TextField } from '../shared/form'

export function ProjectNameModal({ title, value }: { title: string; value: string }) {
  return (
    <Form title={title} keybindsModeId="modal.project-name" width={uiTokens.modalWidth.md}>
      <TextField active value={value} />
    </Form>
  )
}

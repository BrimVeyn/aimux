import { uiTokens } from '../../../ui-tokens'
import { Form, TextField } from '../shared/form'

export function SessionNameModal({ title, value }: { title: string; value: string }) {
  return (
    <Form title={title} keybindsModeId="modal.session-name" width={uiTokens.modalWidth.md}>
      <TextField active value={value} />
    </Form>
  )
}

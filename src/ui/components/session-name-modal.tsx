import { uiTokens } from '../ui-tokens'
import { InputField } from './input-field'
import { ModalShell } from './modal-shell'

export function SessionNameModal({ title, value }: { title: string; value: string }) {
  return (
    <ModalShell title={title} keybindsModeId="modal.session-name" width={uiTokens.modalWidth.md}>
      <InputField active value={value} />
    </ModalShell>
  )
}

import { useModalHelp } from '../keymap-context'
import { uiTokens } from '../ui-tokens'
import { InputField } from './input-field'
import { ModalShell } from './modal-shell'

export function SessionNameModal({ title, value }: { title: string; value: string }) {
  const help = useModalHelp('modal.session-name')
  return (
    <ModalShell title={title} help={help} width={uiTokens.modalWidth.md}>
      <InputField active value={value} />
    </ModalShell>
  )
}

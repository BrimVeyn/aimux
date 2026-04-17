import { useModalHelp } from '../keymap-context'
import { theme } from '../theme'
import { uiTokens } from '../ui-tokens'
import { InputField } from './input-field'
import { ModalShell } from './modal-shell'

interface GitCommitModalProps {
  activeField: 'title' | 'body'
  title: string
  body: string
  cursorPos: number
}

export function GitCommitModal({ activeField, body, cursorPos, title }: GitCommitModalProps) {
  const titleActive = activeField === 'title'
  const bodyActive = activeField === 'body'
  const help = useModalHelp('modal.git-commit')

  return (
    <ModalShell title="Commit" help={help} width={uiTokens.modalWidth.xl}>
      <box flexDirection="column">
        <text fg={titleActive ? theme.text : theme.textMuted}>Title</text>
        <InputField
          active={titleActive}
          cursorPos={titleActive ? cursorPos : undefined}
          value={title}
        />
      </box>

      <box flexDirection="column">
        <text fg={bodyActive ? theme.text : theme.textMuted}>Body (optional)</text>
        <InputField
          active={bodyActive}
          cursorPos={bodyActive ? cursorPos : undefined}
          value={body}
        />
      </box>
    </ModalShell>
  )
}

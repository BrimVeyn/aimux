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

  return (
    <ModalShell
      title="Commit"
      help="Tab switch · ←→ move cursor · Enter newline (body) · Ctrl+Enter commit · Esc cancel"
      width={uiTokens.modalWidth.xl}
    >
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

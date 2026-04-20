import { useTokens } from '../theme'
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
  const t = useTokens()
  const titleActive = activeField === 'title'
  const bodyActive = activeField === 'body'

  return (
    <ModalShell title="Commit" keybindsModeId="modal.git-commit" width={uiTokens.modalWidth.xl}>
      <box flexDirection="column">
        <text fg={titleActive ? t.palette.ink : t.muted}>Title</text>
        <InputField
          active={titleActive}
          cursorPos={titleActive ? cursorPos : undefined}
          value={title}
        />
      </box>

      <box flexDirection="column">
        <text fg={bodyActive ? t.palette.ink : t.muted}>Body (optional)</text>
        <InputField
          active={bodyActive}
          cursorPos={bodyActive ? cursorPos : undefined}
          value={body}
        />
      </box>
    </ModalShell>
  )
}

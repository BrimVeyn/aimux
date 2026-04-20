import { useTokens } from '../theme'
import { uiTokens } from '../ui-tokens'
import { InputField } from './input-field'
import { ModalShell } from './modal-shell'
import { WizardHead } from './wizard-head'

interface AutoCommitModalProps {
  activeField: 'title' | 'body'
  editing: boolean
  title: string
  body: string
  cursorPos: number
}

export function AutoCommitModal({
  activeField,
  body,
  cursorPos,
  editing,
  title,
}: AutoCommitModalProps) {
  const t = useTokens()
  const titleActive = editing && activeField === 'title'
  const bodyActive = editing && activeField === 'body'

  return (
    <ModalShell
      keybindsModeId={editing ? 'modal.auto-commit.editing' : 'modal.auto-commit'}
      title="Auto-commit suggestion"
      width={uiTokens.modalWidth.xl}
    >
      <box alignItems="center" flexDirection="column">
        <WizardHead />
      </box>
      <box flexDirection="column">
        <text fg={titleActive ? t.palette.ink : t.muted}>Title</text>
        <InputField
          active={titleActive}
          cursorPos={titleActive ? cursorPos : undefined}
          value={title}
        />
      </box>

      <box flexDirection="column">
        <text fg={bodyActive ? t.palette.ink : t.muted}>Body</text>
        <InputField
          active={bodyActive}
          cursorPos={bodyActive ? cursorPos : undefined}
          value={body}
        />
      </box>
    </ModalShell>
  )
}

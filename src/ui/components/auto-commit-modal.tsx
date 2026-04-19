import { useTheme } from '../theme'
import { uiTokens } from '../ui-tokens'
import { ModalShell } from './modal-shell'
import { WizardHead } from './wizard-head'

interface AutoCommitModalProps {
  title: string
  body: string
}

export function AutoCommitModal({ body, title }: AutoCommitModalProps) {
  const theme = useTheme()
  return (
    <ModalShell
      keybindsModeId="modal.auto-commit"
      title="Auto-commit suggestion"
      width={uiTokens.modalWidth.xl}
    >
      <box alignItems="center" flexDirection="column">
        <WizardHead />
      </box>
      <box flexDirection="column">
        <text fg={theme.colors['descriptionForeground']}>Title</text>
        <text>{title}</text>
      </box>
      <box flexDirection="column">
        <text fg={theme.colors['descriptionForeground']}>Body</text>
        <text>{body || '—'}</text>
      </box>
      <box flexDirection="row" justifyContent="center">
        <text fg={theme.colors['descriptionForeground']}>[Y] Commit [N] Dismiss</text>
      </box>
    </ModalShell>
  )
}

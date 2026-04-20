import { dispatchGlobal } from '../../state/dispatch-ref'
import { useTokens } from '../theme'
import { uiTokens } from '../ui-tokens'
import { InputField } from './input-field'
import { ModalShell } from './modal-shell'

interface GitCommitModalProps {
  activeField: 'title' | 'body'
  title: string
  body: string
  cursorPos: number
  stage: 'edit' | 'confirm'
}

export function GitCommitModal({
  activeField,
  body,
  cursorPos,
  stage,
  title,
}: GitCommitModalProps) {
  const t = useTokens()
  const titleActive = activeField === 'title'
  const bodyActive = activeField === 'body'
  const isConfirm = stage === 'confirm'

  return (
    <ModalShell
      title={isConfirm ? 'Auto-commit (stage all + commit)' : 'Commit'}
      keybindsModeId={isConfirm ? 'modal.git-commit.confirm' : 'modal.git-commit'}
      width={uiTokens.modalWidth.xl}
    >
      {isConfirm ? (
        <box flexDirection="column">
          <text fg={t.palette.warning}>
            <strong>git add -A</strong> will stage every change before committing.
          </text>
          <text fg={t.muted}>Enter to confirm · Esc to cancel · edits below still apply.</text>
        </box>
      ) : null}

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

      {isConfirm ? null : (
        <box flexDirection="row" gap={1} marginTop={1}>
          <box
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              dispatchGlobal({ type: 'git-commit-enter-confirm' })
            }}
            borderStyle="single"
            borderColor={t.palette.primary}
            paddingLeft={1}
            paddingRight={1}
          >
            <text fg={t.palette.primary}>
              <strong>🪄 Auto-commit</strong>
            </text>
          </box>
          <text fg={t.muted}>C-a · stages all changes with this message</text>
        </box>
      )}
    </ModalShell>
  )
}

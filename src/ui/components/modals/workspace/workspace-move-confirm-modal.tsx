import { useTheme } from '../../../theme'
import { uiTokens } from '../../../ui-tokens'
import { Form } from '../shared/form'

interface WorkspaceMoveConfirmModalProps {
  variant: 'stash-target' | 'keep-conflicts'
  files: string[]
  sourceLabel: string
  targetLabel: string
}

const MAX_LISTED_FILES = 8

/**
 * Confirmation dialog after a recoverable move failure. Both workspaces are
 * already back in their original state; confirming re-runs the move with the
 * flag matching the variant (stash the target's changes / keep the conflict
 * markers in the target).
 */
export function WorkspaceMoveConfirmModal({
  files,
  sourceLabel,
  targetLabel,
  variant,
}: WorkspaceMoveConfirmModalProps) {
  const t = useTheme()
  const listed = files.slice(0, MAX_LISTED_FILES)
  const remaining = files.length - listed.length
  const isStash = variant === 'stash-target'
  return (
    <Form
      title={isStash ? 'Target has conflicting changes' : 'Move hit conflicts'}
      keybindsModeId="modal.workspace-move-confirm"
      width={uiTokens.modalWidth.md}
      footer={
        <text fg={t.textMuted}>
          {isStash
            ? 'Enter / y to stash & move · Esc / n to cancel'
            : 'Enter / y to keep markers · Esc / n to cancel'}
        </text>
      }
    >
      <box flexDirection="column" gap={1}>
        <text fg={t.text}>
          {isStash
            ? `${targetLabel} has uncommitted changes that the move would overwrite:`
            : `Merging ${sourceLabel} into ${targetLabel} conflicts in ${files.length} file(s):`}
        </text>
        <box flexDirection="column">
          {listed.map((file) => (
            <text key={file} fg={t.warning} wrapMode="none">
              {file}
            </text>
          ))}
          {remaining > 0 ? <text fg={t.textMuted}>+{remaining} more</text> : null}
        </box>
        <text fg={t.text}>
          {isStash
            ? 'Stash them and continue? The stash is kept — recover with git stash pop.'
            : `Keep conflict markers in ${targetLabel} for manual resolution? ${sourceLabel} stays untouched either way.`}
        </text>
      </box>
    </Form>
  )
}

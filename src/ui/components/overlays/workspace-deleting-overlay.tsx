import { useWorkspaceDeleteStore } from '../../../state/workspace-delete-store'
import { useBusySpinner } from '../../hooks/use-busy-spinner'
import { useTheme } from '../../theme'
import { uiTokens } from '../../ui-tokens'
import { ModalShell } from '../modals/shared/modal-shell'

/**
 * The card that stands in for the confirmation while the git work runs. Same
 * shell, same width, same place on screen as the dialog that was just there, so
 * confirming reads as the dialog changing what it says rather than the screen
 * going quiet for a few seconds.
 */
function DeletingCard({ label }: { label: string }) {
  const t = useTheme()
  const spinner = useBusySpinner()
  return (
    <ModalShell title={`${spinner} Deleting workspace`} width={uiTokens.modalWidth.md}>
      <text fg={t.textMuted}>{label}</text>
    </ModalShell>
  )
}

export function WorkspaceDeletingOverlay() {
  // Joined in the selector so the subscription compares a string: a fresh object
  // every render would re-render the whole root on every unrelated store write.
  const label = useWorkspaceDeleteStore((state) => Object.values(state.deleting).join(' · '))
  if (label === '') return null
  return <DeletingCard label={label} />
}

import { useAppStore } from '../../../state/app-store'
import { useWorkspaceDeleteStore } from '../../../state/workspace-delete-store'
import { useBusySpinner } from '../../hooks/use-busy-spinner'
import { useTheme } from '../../theme'
import { uiTokens } from '../../ui-tokens'
import { ModalShell } from '../modals/shared/modal-shell'

/**
 * The label of the delete running on the workspace you are looking at, or ''.
 * Scoped to the active workspace on purpose: a delete is not a modal state, it
 * is something happening to one row, so it takes the screen that row owns and
 * leaves every other one alone.
 */
export function useActiveWorkspaceDeleteLabel(): string {
  const activeWorkspaceId = useAppStore(
    (s) => s.projects.find((project) => project.id === s.currentProjectId)?.activeWorkspaceId ?? ''
  )
  return useWorkspaceDeleteStore((s) => s.deleting[activeWorkspaceId] ?? '')
}

/**
 * The card that stands in for the confirmation while the git work runs. Same
 * shell, same width, same place on screen as the dialog that was just there, so
 * confirming reads as the dialog changing what it says rather than the screen
 * going quiet for a few seconds. It replaces the panes rather than covering the
 * app: the sidebar stays live, and switching away from a workspace that is
 * going takes you somewhere you can keep working.
 */
export function WorkspaceDeletingView({ label }: { label: string }) {
  const t = useTheme()
  const spinner = useBusySpinner()
  return (
    <ModalShell title={`${spinner} Deleting workspace`} width={uiTokens.modalWidth.md}>
      <text fg={t.textMuted}>{label}</text>
    </ModalShell>
  )
}

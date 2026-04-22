import type { GitPaneMode, GitPanePosition, GitPaneState } from '../../../../state/types'
import type { ContextMenuItem } from '../../../context-menu/controller'

const GIT_PANE_MENU_OPTIONS: Array<{
  label: string
  mode: GitPaneMode
  position: GitPanePosition
}> = [
  { label: 'Move to top', mode: 'embedded', position: 'top' },
  { label: 'Move to bottom', mode: 'embedded', position: 'bottom' },
  { label: 'Move to left', mode: 'pane', position: 'left' },
  { label: 'Move to right', mode: 'pane', position: 'right' },
]

export function buildGitPaneContextMenu(
  gitPane: Pick<GitPaneState, 'mode' | 'position'>,
  onToggle: () => void,
  onMove: (mode: GitPaneMode, position: GitPanePosition) => void
): ContextMenuItem[] {
  return [
    ['Toggle', onToggle],
    ...GIT_PANE_MENU_OPTIONS.filter(
      ({ mode, position }) => !(gitPane.mode === mode && gitPane.position === position)
    ).map(({ label, mode, position }) => [label, () => onMove(mode, position)] as ContextMenuItem),
  ]
}

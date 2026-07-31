import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { memo, useCallback, useMemo } from 'react'

import type { ProjectRecord, WorkspaceRecord } from '../../../../state/types'

import { useAppStore } from '../../../../state/app-store'
import { dispatchGlobal, runSideEffectGlobal } from '../../../../state/dispatch-ref'
import { formatDivergence } from '../../../../state/project-workspaces'
import { useBaseTheme, useTheme } from '../../../theme'
import { FlashLabelBadge } from '../../flash/flash-label-badge'
import { ContextMenuBox } from '../../overlays/context-menu/context-menu-box'

interface WorkspaceRowProps {
  project: ProjectRecord
  workspace: WorkspaceRecord
  /** 1-based index of the project in the visible order (for switch-project-by-index). */
  projectIndex: number
  /** True when this row is the active cursor item. */
  isActiveItem: boolean
  /** True when this row's project is the current project (selection scope). */
  inCurrentGroup: boolean
  /** True when this is the last non-primary workspace of its project. Drives └─ vs ├─. */
  isLast: boolean
}

export const WorkspaceRow = memo(function WorkspaceRow({
  inCurrentGroup,
  isActiveItem,
  isLast,
  project,
  projectIndex,
  workspace,
}: WorkspaceRowProps) {
  const t = useTheme()
  // Selection highlight must stay opaque in transparent mode.
  const base = useBaseTheme()
  const currentProjectId = useAppStore((s) => s.currentProjectId)
  const isCurrentProject = project.id === currentProjectId
  const divergence = useAppStore((s) => s.workspaceDivergence[workspace.id])

  const handleMouseDown = useCallback(
    (event: OtuiMouseEvent) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      if (isCurrentProject) {
        dispatchGlobal({
          projectId: project.id,
          type: 'set-active-workspace',
          workspaceId: workspace.id,
        })
        return
      }
      // Cross-project click: send the workspace id along with the switch so
      // the side effect can apply it atomically. Splitting it into a separate
      // dispatch+switch leaves a window where subscribers/re-renders can
      // re-assert the target project's last-persisted workspace.
      runSideEffectGlobal({
        index: projectIndex,
        type: 'switch-project-by-index',
        workspaceId: workspace.id,
      })
    },
    [isCurrentProject, project.id, projectIndex, workspace.id]
  )

  const rightClickMenu = useMemo<[string, () => void][] | undefined>(() => {
    const entries: [string, () => void][] = [
      [
        'Rename',
        () =>
          dispatchGlobal({
            initialName: workspace.name,
            projectId: project.id,
            type: 'open-rename-workspace-modal',
            workspaceId: workspace.id,
          }),
      ],
    ]
    if (workspace.source !== 'primary') {
      entries.push([
        'Remove workspace',
        () =>
          // Always confirm first. Confirming routes through the full delete side
          // effect (closes the workspace's tabs, disposes their PTYs, prunes the
          // snapshot, removes the git worktree). closeTabs (not force) cleans up
          // the tabs while keeping the non-force `git worktree remove`, so
          // uncommitted work in a temp workspace is still protected — a dirty
          // workspace re-prompts for an explicit force-delete.
          dispatchGlobal({
            closeTabs: true,
            force: false,
            projectId: project.id,
            reason: 'Its assistant tabs will be closed and the worktree removed.',
            type: 'open-workspace-delete-confirm',
            workspaceId: workspace.id,
            workspaceLabel: workspace.branch ?? workspace.name,
          }),
      ])
    }
    return entries
  }, [project.id, workspace.branch, workspace.id, workspace.name, workspace.source])

  let bgColor: string | undefined
  if (isActiveItem) {
    bgColor = base.backgroundElement
  } else if (inCurrentGroup) {
    bgColor = base.backgroundPanel
  }

  const connector = isLast ? '└─' : '├─'
  const branchCont = isLast ? '   ' : '│  '
  const branchText = workspace.branch ?? ''
  const showBranch = branchText !== ''
  const divergenceText = formatDivergence(divergence)

  return (
    <ContextMenuBox
      id={`sidebar-wt-${workspace.id}`}
      flexDirection="column"
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={bgColor}
      rightClickMenu={rightClickMenu}
      onMouseDown={handleMouseDown}
    >
      <box flexDirection="row" alignItems="center">
        <text fg={t.textMuted} selectable={false} wrapMode="none">
          {connector}{' '}
        </text>
        <FlashLabelBadge rowKey={`wt:${workspace.id}`} />
        <text fg={t.text} selectable={false} wrapMode="none">
          {workspace.name}
        </text>
      </box>
      {showBranch ? (
        <box flexDirection="row">
          <text fg={t.textMuted} selectable={false} wrapMode="none">
            {branchCont}
            {'\u{e702}'} {branchText}
            {divergenceText !== '' ? ` ${divergenceText}` : ''}
          </text>
        </box>
      ) : null}
    </ContextMenuBox>
  )
})

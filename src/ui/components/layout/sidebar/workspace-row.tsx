import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { memo, useCallback, useMemo } from 'react'

import type { ProjectRecord, WorkspaceRecord } from '../../../../state/types'

import { useAppStore } from '../../../../state/app-store'
import { dispatchGlobal, runSideEffectGlobal } from '../../../../state/dispatch-ref'
import { formatDiffStat } from '../../../../state/project-workspaces'
// eslint-disable-next-line no-duplicate-imports
import { IDLE_WORKSPACE_ACTIVITY } from '../../../../state/types'
import { useBusySpinner } from '../../../hooks/use-busy-spinner'
import { useBaseTheme, useTheme } from '../../../theme'
import { truncate } from '../../../truncate'
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
  contentWidth: number
}

export const WorkspaceRow = memo(function WorkspaceRow({
  contentWidth,
  inCurrentGroup,
  isActiveItem,
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
  const activity = useAppStore((s) => s.workspaceActivity[workspace.id]) ?? IDLE_WORKSPACE_ACTIVITY
  // Only the working case animates, so the timer is off for every other row.
  const spinner = useBusySpinner(activity.working)

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

  const { added, removed } = formatDiffStat(divergence)
  const statWidth = added.length + removed.length + (added !== '' && removed !== '' ? 1 : 0)
  const nameLabel = truncate(
    workspace.name,
    Math.max(0, contentWidth - 5 - (statWidth > 0 ? statWidth + 1 : 0))
  )
  // Second line, aligned under the name (2 padding + the 4-cell glyph run).
  // Only workspaces that own a branch get one — an external checkout without
  // one would otherwise be a row of a different height for no information.
  const branchLabel =
    workspace.branch == null || workspace.branch === ''
      ? null
      : truncate(workspace.branch, Math.max(0, contentWidth - 6))

  // Same vocabulary as the project heading one level up, in the same priority:
  // a question outranks work in progress, which outranks "it finished and you
  // haven't looked". A space when there is nothing to say — the row keeps its
  // width either way, so nothing shifts.
  let statusGlyph = ' '
  let statusColor = t.textMuted
  if (activity.waiting) {
    statusGlyph = '?'
    statusColor = t.warning
  } else if (activity.working) {
    statusGlyph = spinner
    statusColor = t.primary
  } else if (activity.done) {
    statusGlyph = '✓'
    statusColor = t.success
  }

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
        <text fg={statusColor} selectable={false} wrapMode="none">
          {statusGlyph}{' '}
        </text>
        <text fg={t.textMuted} selectable={false} wrapMode="none">
          {'\u{e702}'}{' '}
        </text>
        <FlashLabelBadge rowKey={`wt:${workspace.id}`} />
        <text fg={isActiveItem ? t.text : t.textMuted} selectable={false} wrapMode="none">
          {nameLabel}
        </text>
        <box flexGrow={1} flexShrink={1} />
        {added !== '' ? (
          <text fg={t.success} selectable={false} wrapMode="none">
            {added}
          </text>
        ) : null}
        {added !== '' && removed !== '' ? (
          <text fg={t.textMuted} selectable={false} wrapMode="none">
            {' '}
          </text>
        ) : null}
        {removed !== '' ? (
          <text fg={t.error} selectable={false} wrapMode="none">
            {removed}
          </text>
        ) : null}
      </box>
      {branchLabel == null ? null : (
        <text fg={t.textMuted} selectable={false} wrapMode="none">
          {'    '}
          {branchLabel}
        </text>
      )}
    </ContextMenuBox>
  )
})

import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { memo, useCallback, useMemo } from 'react'

import type { ProjectRecord, WorktreeRecord } from '../../../../state/types'

import { useAppStore } from '../../../../state/app-store'
import { dispatchGlobal, runSideEffectGlobal } from '../../../../state/dispatch-ref'
import { formatDivergence } from '../../../../state/project-worktrees'
import { useBaseTheme, useTheme } from '../../../theme'
import { FlashLabelBadge } from '../../flash/flash-label-badge'
import { ContextMenuBox } from '../../overlays/context-menu/context-menu-box'

interface WorktreeRowProps {
  project: ProjectRecord
  worktree: WorktreeRecord
  /** 1-based index of the workspace in the visible order (for switch-project-by-index). */
  projectIndex: number
  /** True when this row is the active cursor item. */
  isActiveItem: boolean
  /** True when this row's workspace is the current project (selection scope). */
  inCurrentGroup: boolean
  /** True when this is the last non-primary worktree of its workspace. Drives └─ vs ├─. */
  isLast: boolean
}

export const WorktreeRow = memo(function WorktreeRow({
  inCurrentGroup,
  isActiveItem,
  isLast,
  project,
  projectIndex,
  worktree,
}: WorktreeRowProps) {
  const t = useTheme()
  // Selection highlight must stay opaque in transparent mode.
  const base = useBaseTheme()
  const currentProjectId = useAppStore((s) => s.currentProjectId)
  const isCurrentProject = project.id === currentProjectId
  const divergence = useAppStore((s) => s.worktreeDivergence[worktree.id])

  const handleMouseDown = useCallback(
    (event: OtuiMouseEvent) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      if (isCurrentProject) {
        dispatchGlobal({
          projectId: project.id,
          type: 'set-active-worktree',
          worktreeId: worktree.id,
        })
        return
      }
      // Cross-workspace click: send the worktree id along with the switch so
      // the side effect can apply it atomically. Splitting it into a separate
      // dispatch+switch leaves a window where subscribers/re-renders can
      // re-assert the target project's last-persisted worktree.
      runSideEffectGlobal({
        index: projectIndex,
        type: 'switch-project-by-index',
        worktreeId: worktree.id,
      })
    },
    [isCurrentProject, project.id, projectIndex, worktree.id]
  )

  const rightClickMenu = useMemo<[string, () => void][] | undefined>(() => {
    const entries: [string, () => void][] = [
      [
        'Rename',
        () =>
          dispatchGlobal({
            initialName: worktree.name,
            projectId: project.id,
            type: 'open-rename-worktree-modal',
            worktreeId: worktree.id,
          }),
      ],
    ]
    if (worktree.source !== 'primary') {
      entries.push([
        'Remove worktree',
        () =>
          // Always confirm first. Confirming routes through the full delete side
          // effect (closes the worktree's tabs, disposes their PTYs, prunes the
          // snapshot, removes the git worktree). closeTabs (not force) cleans up
          // the tabs while keeping the non-force `git worktree remove`, so
          // uncommitted work in a temp worktree is still protected — a dirty
          // worktree re-prompts for an explicit force-delete.
          dispatchGlobal({
            closeTabs: true,
            force: false,
            projectId: project.id,
            reason: 'Its assistant tabs will be closed and the worktree removed.',
            type: 'open-worktree-delete-confirm',
            worktreeId: worktree.id,
            worktreeLabel: worktree.branch ?? worktree.name,
          }),
      ])
    }
    return entries
  }, [project.id, worktree.branch, worktree.id, worktree.name, worktree.source])

  let bgColor: string | undefined
  if (isActiveItem) {
    bgColor = base.backgroundElement
  } else if (inCurrentGroup) {
    bgColor = base.backgroundPanel
  }

  const connector = isLast ? '└─' : '├─'
  const branchCont = isLast ? '   ' : '│  '
  const branchText = worktree.branch ?? ''
  const showBranch = branchText !== ''
  const divergenceText = formatDivergence(divergence)

  return (
    <ContextMenuBox
      id={`sidebar-wt-${worktree.id}`}
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
        <FlashLabelBadge rowKey={`wt:${worktree.id}`} />
        <text fg={t.text} selectable={false} wrapMode="none">
          {worktree.name}
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

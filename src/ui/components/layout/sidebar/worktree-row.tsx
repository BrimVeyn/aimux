import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { memo, useCallback, useMemo } from 'react'

import type { SessionRecord, WorktreeRecord } from '../../../../state/types'

import { useAppStore } from '../../../../state/app-store'
import { dispatchGlobal, runSideEffectGlobal } from '../../../../state/dispatch-ref'
import { formatDivergence } from '../../../../state/session-worktrees'
import { useTheme } from '../../../theme'
import { ContextMenuBox } from '../../overlays/context-menu/context-menu-box'

interface WorktreeRowProps {
  session: SessionRecord
  worktree: WorktreeRecord
  /** 1-based index of the workspace in the visible order (for switch-session-by-index). */
  sessionIndex: number
  /** True when this row is the active cursor item. */
  isActiveItem: boolean
  /** True when this row's workspace is the current session (selection scope). */
  inCurrentGroup: boolean
  /** True when this is the last non-primary worktree of its workspace. Drives └─ vs ├─. */
  isLast: boolean
}

export const WorktreeRow = memo(function WorktreeRow({
  inCurrentGroup,
  isActiveItem,
  isLast,
  session,
  sessionIndex,
  worktree,
}: WorktreeRowProps) {
  const t = useTheme()
  const currentSessionId = useAppStore((s) => s.currentSessionId)
  const isCurrentSession = session.id === currentSessionId
  const divergence = useAppStore((s) => s.worktreeDivergence[worktree.id])

  const handleMouseDown = useCallback(
    (event: OtuiMouseEvent) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      if (isCurrentSession) {
        dispatchGlobal({
          sessionId: session.id,
          type: 'set-active-worktree',
          worktreeId: worktree.id,
        })
        return
      }
      // Cross-workspace click: send the worktree id along with the switch so
      // the side effect can apply it atomically. Splitting it into a separate
      // dispatch+switch leaves a window where subscribers/re-renders can
      // re-assert the target session's last-persisted worktree.
      runSideEffectGlobal({
        index: sessionIndex,
        type: 'switch-session-by-index',
        worktreeId: worktree.id,
      })
    },
    [isCurrentSession, session.id, sessionIndex, worktree.id]
  )

  const rightClickMenu = useMemo<[string, () => void][] | undefined>(() => {
    const entries: [string, () => void][] = [
      [
        'Rename',
        () =>
          dispatchGlobal({
            initialName: worktree.name,
            sessionId: session.id,
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
            reason: 'Its assistant tabs will be closed and the worktree removed.',
            sessionId: session.id,
            type: 'open-worktree-delete-confirm',
            worktreeId: worktree.id,
            worktreeLabel: worktree.branch ?? worktree.name,
          }),
      ])
    }
    return entries
  }, [session.id, worktree.branch, worktree.id, worktree.name, worktree.source])

  let bgColor: string | undefined
  if (isActiveItem) {
    bgColor = t.backgroundElement
  } else if (inCurrentGroup) {
    bgColor = t.backgroundPanel
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

import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { memo, useCallback, useMemo } from 'react'

import type { SessionRecord, WorktreeRecord } from '../../../../state/types'

import { useAppStore } from '../../../../state/app-store'
import { dispatchGlobal, runSideEffectGlobal } from '../../../../state/dispatch-ref'
import { getWorktreeColor } from '../../../../state/session-worktrees'
import { useTheme } from '../../../theme'
import { ContextMenuBox } from '../../overlays/context-menu/context-menu-box'
import { WorktreeChip } from '../../worktree/worktree-chip'

interface WorktreeRowProps {
  session: SessionRecord
  worktree: WorktreeRecord
  /** 1-based index of the workspace in the visible order (for switch-session-by-index). */
  sessionIndex: number
  /** True when this row is the active worktree of the current session. */
  active: boolean
}

export const WorktreeRow = memo(function WorktreeRow({
  active,
  session,
  sessionIndex,
  worktree,
}: WorktreeRowProps) {
  const t = useTheme()
  const divergence = useAppStore((s) => s.worktreeDivergence[worktree.id])
  const currentSessionId = useAppStore((s) => s.currentSessionId)
  const isCurrentSession = session.id === currentSessionId

  const color = worktree.color ?? getWorktreeColor(worktree.id)
  const branch = worktree.branch ?? worktree.name

  const handleMouseDown = useCallback(
    (event: OtuiMouseEvent) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      // Set the desired worktree on the session record first so the
      // subsequent session switch (if any) loads with it already active.
      dispatchGlobal({
        sessionId: session.id,
        type: 'set-active-worktree',
        worktreeId: worktree.id,
      })
      if (!isCurrentSession) {
        runSideEffectGlobal({ index: sessionIndex, type: 'switch-session-by-index' })
      }
    },
    [isCurrentSession, session.id, sessionIndex, worktree.id]
  )

  const rightClickMenu = useMemo<[string, () => void][] | undefined>(() => {
    if (worktree.source === 'primary') return
    return [
      [
        'Remove worktree',
        () =>
          dispatchGlobal({
            sessionId: session.id,
            type: 'remove-worktree-record',
            worktreeId: worktree.id,
          }),
      ],
    ]
  }, [session.id, worktree.id, worktree.source])

  const showTmp = worktree.source === 'aimux-temp'

  return (
    <ContextMenuBox
      id={`sidebar-wt-${worktree.id}`}
      flexDirection="row"
      paddingLeft={1}
      paddingRight={1}
      alignItems="center"
      backgroundColor={active ? t.backgroundElement : undefined}
      rightClickMenu={rightClickMenu}
      onMouseDown={handleMouseDown}
    >
      <text fg={t.textMuted} selectable={false} wrapMode="none">
        {'  '}
      </text>
      <WorktreeChip
        branch={branch}
        color={color}
        divergence={divergence}
        paddingLeft={0}
        paddingRight={0}
      />
      {showTmp ? (
        <text fg={t.textMuted} selectable={false} wrapMode="none">
          {' tmp'}
        </text>
      ) : null}
    </ContextMenuBox>
  )
})

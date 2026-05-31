import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { memo, useCallback, useMemo } from 'react'

import type { SessionRecord, WorktreeRecord } from '../../../../state/types'

import { useAppStore } from '../../../../state/app-store'
import { dispatchGlobal, runSideEffectGlobal } from '../../../../state/dispatch-ref'
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
}

export const WorktreeRow = memo(function WorktreeRow({
  inCurrentGroup,
  isActiveItem,
  session,
  sessionIndex,
  worktree,
}: WorktreeRowProps) {
  const t = useTheme()
  const currentSessionId = useAppStore((s) => s.currentSessionId)
  const isCurrentSession = session.id === currentSessionId

  const handleMouseDown = useCallback(
    (event: OtuiMouseEvent) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
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

  let bgColor: string | undefined
  if (isActiveItem) {
    bgColor = t.backgroundElement
  } else if (inCurrentGroup) {
    bgColor = t.backgroundPanel
  }

  return (
    <ContextMenuBox
      id={`sidebar-wt-${worktree.id}`}
      flexDirection="row"
      paddingLeft={1}
      paddingRight={1}
      alignItems="center"
      backgroundColor={bgColor}
      rightClickMenu={rightClickMenu}
      onMouseDown={handleMouseDown}
    >
      <text fg={t.textMuted} selectable={false} wrapMode="none">
        {'  > '}
      </text>
      <text fg={isActiveItem ? t.text : t.textMuted} selectable={false} wrapMode="none">
        {worktree.name}
      </text>
    </ContextMenuBox>
  )
})

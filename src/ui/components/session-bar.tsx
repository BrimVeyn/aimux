import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { useMemo, useRef } from 'react'

import type { SessionRecord } from '../../state/types'

import { useAppStore } from '../../state/app-store'
import { dispatchGlobal, runSideEffectGlobal } from '../../state/dispatch-ref'
import { useBusySpinner } from '../hooks/use-busy-spinner'
import { orderSessionsForDisplay } from '../session-ordering'
import { theme } from '../theme'

interface DragState {
  sourceId: string | null
}

export function SessionBar() {
  const sessions = useAppStore((s) => s.sessions)
  const currentId = useAppStore((s) => s.currentSessionId)
  const bar = useAppStore((s) => s.sessionBar)
  const busyMap = useAppStore((s) => s.sessionsBusy)
  const dragRef = useRef<DragState>({ sourceId: null })

  const ordered = useMemo(() => orderSessionsForDisplay(sessions), [sessions])
  if (!bar.visible || ordered.length === 0) return null

  const handleMouseDown = (id: string) => {
    dragRef.current.sourceId = id
  }

  const handleMouseUp = (targetId: string, targetIndex: number) => {
    const sourceId = dragRef.current.sourceId
    dragRef.current.sourceId = null

    if (!sourceId) return
    if (sourceId === targetId) {
      // Click — switch to this session
      runSideEffectGlobal({ index: targetIndex + 1, type: 'switch-session-by-index' })
      return
    }

    // Drag → reorder: move sourceId into targetIndex slot
    const ids = ordered.map((s) => s.id)
    const srcIdx = ids.indexOf(sourceId)
    if (srcIdx < 0) return
    ids.splice(srcIdx, 1)
    const insertAt = ids.indexOf(targetId)
    const adjusted = insertAt < 0 ? ids.length : insertAt
    ids.splice(adjusted, 0, sourceId)
    dispatchGlobal({ orderedIds: ids, type: 'reorder-sessions' })
  }

  return (
    <box
      width="100%"
      flexDirection="row"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={theme.panelMuted}
    >
      {ordered.map((session, i) => (
        <SessionChip
          key={session.id}
          session={session}
          index={i + 1}
          active={session.id === currentId}
          busy={busyMap[session.id] ?? false}
          onMouseDown={() => handleMouseDown(session.id)}
          onMouseUp={() => handleMouseUp(session.id, i)}
        />
      ))}
    </box>
  )
}

interface SessionChipProps {
  session: SessionRecord
  index: number
  active: boolean
  busy: boolean
  onMouseDown: (event: OtuiMouseEvent) => void
  onMouseUp: (event: OtuiMouseEvent) => void
}

function SessionChip({ active, busy, index, onMouseDown, onMouseUp, session }: SessionChipProps) {
  const showSpinner = busy && !active
  const spinner = useBusySpinner(showSpinner)
  const indicator = showSpinner ? spinner : '●'
  const indicatorColor = active || showSpinner ? theme.accent : theme.success
  const labelColor = active ? theme.text : theme.textMuted
  const bgColor = active ? theme.panelHighlight : undefined

  return (
    <box
      flexDirection="row"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={bgColor}
      onMouseDown={(e) => {
        e.preventDefault()
        onMouseDown(e)
      }}
      onMouseUp={(e) => {
        e.preventDefault()
        onMouseUp(e)
      }}
    >
      <text fg={indicatorColor}>{indicator} </text>
      <text fg={labelColor}>
        [{index}] {session.name}
      </text>
      <text fg={theme.dim}> </text>
    </box>
  )
}

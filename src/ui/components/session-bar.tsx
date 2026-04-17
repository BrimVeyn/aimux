import type { MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { useMemo, useState } from 'react'

import type { SessionRecord } from '../../state/types'

import { useAppStore } from '../../state/app-store'
import { dispatchGlobal, runSideEffectGlobal } from '../../state/dispatch-ref'
import { useBusySpinner } from '../hooks/use-busy-spinner'
import { moveIdToIdPosition, orderSessionsForDisplay } from '../session-ordering'
import { theme } from '../theme'

export function SessionBar() {
  const sessions = useAppStore((s) => s.sessions)
  const currentId = useAppStore((s) => s.currentSessionId)
  const bar = useAppStore((s) => s.sessionBar)
  const busyMap = useAppStore((s) => s.sessionsBusy)

  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOrder, setDragOrder] = useState<string[] | null>(null)

  const ordered = useMemo(() => orderSessionsForDisplay(sessions), [sessions])
  if (!bar.visible || ordered.length === 0) return null

  // When dragging, render from dragOrder so the list updates live; otherwise
  // render the canonical catalog order.
  const visibleSessions =
    dragOrder !== null
      ? dragOrder
          .map((id) => ordered.find((s) => s.id === id))
          .filter((s): s is SessionRecord => !!s)
      : ordered

  const baselineOrder = ordered.map((s) => s.id)

  const handleMouseDown = (id: string) => {
    setDraggingId(id)
    setDragOrder(baselineOrder)
  }

  const handleMouseOver = (hoveredId: string) => {
    if (!draggingId || hoveredId === draggingId) return
    setDragOrder((prev) => (prev ? moveIdToIdPosition(prev, draggingId, hoveredId) : prev))
  }

  const commitDrop = () => {
    const source = draggingId
    const finalOrder = dragOrder
    setDraggingId(null)
    setDragOrder(null)

    if (!source || !finalOrder) return

    const changed = !arraysEqual(finalOrder, baselineOrder)
    if (changed) {
      dispatchGlobal({ orderedIds: finalOrder, type: 'reorder-sessions' })
      return
    }

    // No change → click-to-switch on the originating chip.
    const idx = baselineOrder.indexOf(source)
    if (idx >= 0) {
      runSideEffectGlobal({ index: idx + 1, type: 'switch-session-by-index' })
    }
  }

  const cancelDrag = () => {
    setDraggingId(null)
    setDragOrder(null)
  }

  return (
    <box
      width="100%"
      flexDirection="row"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={theme.panelMuted}
    >
      {visibleSessions.map((session) => {
        const displayIndex = baselineOrder.indexOf(session.id) + 1
        return (
          <SessionChip
            key={session.id}
            session={session}
            index={displayIndex}
            active={session.id === currentId}
            busy={busyMap[session.id] ?? false}
            dragging={draggingId === session.id}
            onMouseDown={() => handleMouseDown(session.id)}
            onMouseOver={() => handleMouseOver(session.id)}
            onMouseUp={commitDrop}
            onMouseDragEnd={cancelDrag}
          />
        )
      })}
    </box>
  )
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

interface SessionChipProps {
  session: SessionRecord
  index: number
  active: boolean
  busy: boolean
  dragging: boolean
  onMouseDown: (event: OtuiMouseEvent) => void
  onMouseOver: (event: OtuiMouseEvent) => void
  onMouseUp: (event: OtuiMouseEvent) => void
  onMouseDragEnd: (event: OtuiMouseEvent) => void
}

function SessionChip({
  active,
  busy,
  dragging,
  index,
  onMouseDown,
  onMouseDragEnd,
  onMouseOver,
  onMouseUp,
  session,
}: SessionChipProps) {
  const showSpinner = busy && !active
  const spinner = useBusySpinner(showSpinner)
  const indicator = showSpinner ? spinner : '●'
  const indicatorColor = active || showSpinner ? theme.accent : theme.success
  const labelColor = active ? theme.text : theme.textMuted
  const bgColor = dragging || active ? theme.panelHighlight : undefined

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
      onMouseOver={(e) => {
        onMouseOver(e)
      }}
      onMouseUp={(e) => {
        e.preventDefault()
        onMouseUp(e)
      }}
      onMouseDragEnd={(e) => {
        onMouseDragEnd(e)
      }}
    >
      <text fg={indicatorColor} selectable={false}>
        {indicator}{' '}
      </text>
      <text fg={labelColor} selectable={false}>
        [{index}] {session.name}
      </text>
      <text fg={theme.dim} selectable={false}>
        {' '}
      </text>
    </box>
  )
}

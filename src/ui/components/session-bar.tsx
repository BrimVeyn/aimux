import type { BoxRenderable, MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { useMemo, useRef, useState } from 'react'

import type { SessionRecord, SessionStatus } from '../../state/types'

import { useAppStore } from '../../state/app-store'
import { dispatchGlobal, runSideEffectGlobal } from '../../state/dispatch-ref'
// eslint-disable-next-line no-duplicate-imports
import { IDLE_SESSION_STATUS } from '../../state/types'
import { useBusySpinner } from '../hooks/use-busy-spinner'
import { moveIdToIdPosition, orderSessionsForDisplay } from '../session-ordering'
import { useTheme } from '../theme'

export function SessionBar() {
  const theme = useTheme()
  const sessions = useAppStore((s) => s.sessions)
  const currentId = useAppStore((s) => s.currentSessionId)
  const bar = useAppStore((s) => s.sessionBar)
  const statusMap = useAppStore((s) => s.sessionStatuses)

  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOrder, setDragOrder] = useState<string[] | null>(null)
  // Hysteresis: the id of the chip we most recently swapped with. While the
  // cursor remains over that chip we refuse to swap back (prevents oscillation
  // when a long chip's new bounds still cover the cursor after a swap).
  const lastSwapWithRef = useRef<string | null>(null)
  // Live bounds of each chip after render, keyed by session id.
  const chipRefs = useRef(new Map<string, BoxRenderable>())

  const ordered = useMemo(() => orderSessionsForDisplay(sessions), [sessions])
  if (!bar.visible || ordered.length === 0) return null

  const visibleSessions =
    dragOrder !== null
      ? dragOrder
          .map((id) => ordered.find((s) => s.id === id))
          .filter((s): s is SessionRecord => !!s)
      : ordered

  const baselineOrder = ordered.map((s) => s.id)

  function setChipRef(id: string, ref: BoxRenderable | null): void {
    if (ref) chipRefs.current.set(id, ref)
    else chipRefs.current.delete(id)
  }

  function findChipAtX(x: number): string | null {
    for (const [id, ref] of chipRefs.current) {
      if (x >= ref.x && x < ref.x + ref.width) return id
    }
    return null
  }

  const handleMouseDown = (id: string) => {
    setDraggingId(id)
    setDragOrder(baselineOrder)
    lastSwapWithRef.current = null
  }

  const handleMouseDrag = (event: OtuiMouseEvent) => {
    if (!draggingId) return
    const hit = findChipAtX(event.x)
    if (hit === null) {
      lastSwapWithRef.current = null
      return
    }
    if (hit === draggingId) {
      lastSwapWithRef.current = null
      return
    }
    if (hit === lastSwapWithRef.current) return
    setDragOrder((prev) => (prev ? moveIdToIdPosition(prev, draggingId, hit) : prev))
    lastSwapWithRef.current = hit
  }

  const commitDrop = () => {
    const source = draggingId
    const finalOrder = dragOrder
    setDraggingId(null)
    setDragOrder(null)
    lastSwapWithRef.current = null

    if (!source || !finalOrder) return

    const changed = !arraysEqual(finalOrder, baselineOrder)
    if (changed) {
      dispatchGlobal({ orderedIds: finalOrder, type: 'reorder-sessions' })
      return
    }

    const idx = baselineOrder.indexOf(source)
    if (idx >= 0) {
      runSideEffectGlobal({ index: idx + 1, type: 'switch-session-by-index' })
    }
  }

  const cancelDrag = () => {
    setDraggingId(null)
    setDragOrder(null)
    lastSwapWithRef.current = null
  }

  return (
    <box
      width="100%"
      flexDirection="row"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={theme.colors['sideBarSectionHeader.background']}
    >
      {visibleSessions.map((session) => {
        const displayIndex = baselineOrder.indexOf(session.id) + 1
        return (
          <SessionChip
            key={session.id}
            session={session}
            index={displayIndex}
            active={session.id === currentId}
            status={statusMap[session.id] ?? IDLE_SESSION_STATUS}
            dragging={draggingId === session.id}
            onRef={(r) => setChipRef(session.id, r)}
            onMouseDown={() => handleMouseDown(session.id)}
            onMouseDrag={handleMouseDrag}
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
  status: SessionStatus
  dragging: boolean
  onRef: (ref: BoxRenderable | null) => void
  onMouseDown: (event: OtuiMouseEvent) => void
  onMouseDrag: (event: OtuiMouseEvent) => void
  onMouseUp: (event: OtuiMouseEvent) => void
  onMouseDragEnd: (event: OtuiMouseEvent) => void
}

function SessionChip({
  active,
  dragging,
  index,
  onMouseDown,
  onMouseDrag,
  onMouseDragEnd,
  onMouseUp,
  onRef,
  session,
  status,
}: SessionChipProps) {
  const theme = useTheme()
  // Active session suppresses its own working spinner (user is already
  // looking at it) but still surfaces the waiting-input glyph — it's an
  // actionable prompt.
  const showSpinner = status.working && !active
  const showWaiting = status.waiting
  const spinner = useBusySpinner(showSpinner)
  const labelColor = active
    ? theme.colors['editor.foreground']
    : theme.colors['descriptionForeground']
  const bgColor = dragging || active ? theme.colors['list.activeSelectionBackground'] : undefined
  const idleColor = theme.colors['gitDecoration.addedResourceForeground'] ?? ''
  const workingColor = theme.colors['textLink.foreground'] ?? ''
  const waitingColor = theme.colors['editorWarning.foreground'] ?? ''

  return (
    <box
      ref={onRef}
      flexDirection="row"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={bgColor}
      onMouseDown={(e) => {
        e.preventDefault()
        onMouseDown(e)
      }}
      onMouseDrag={(e) => {
        onMouseDrag(e)
      }}
      onMouseUp={(e) => {
        e.preventDefault()
        onMouseUp(e)
      }}
      onMouseDragEnd={(e) => {
        onMouseDragEnd(e)
      }}
    >
      {showWaiting ? (
        <text fg={waitingColor} selectable={false}>
          ?{' '}
        </text>
      ) : null}
      {showSpinner ? (
        <text fg={workingColor} selectable={false}>
          {spinner}{' '}
        </text>
      ) : null}
      {!showWaiting && !showSpinner ? (
        <text fg={active ? workingColor : idleColor} selectable={false}>
          {'● '}
        </text>
      ) : null}
      <text fg={labelColor} selectable={false}>
        [{index}] {session.name}
      </text>
      <text fg={theme.colors['editor.lineHighlightBackground']} selectable={false}>
        {' '}
      </text>
    </box>
  )
}

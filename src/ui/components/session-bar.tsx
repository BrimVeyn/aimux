import type { BoxRenderable, MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { useMemo, useRef, useState } from 'react'

import type { SessionRecord, TabActivity } from '../../state/types'

import { useAppStore } from '../../state/app-store'
import { dispatchGlobal, runSideEffectGlobal } from '../../state/dispatch-ref'
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
      // Cursor left the bar entirely — allow the next hit to re-trigger a swap.
      lastSwapWithRef.current = null
      return
    }
    if (hit === draggingId) {
      // Over the dragged chip itself — reset hysteresis so re-entering a
      // neighbour can swap again.
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

    // Drag did not change anything → treat as click, switch to that session.
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
            status={statusMap[session.id] ?? 'idle'}
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
  status: TabActivity
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
  // The active session already has the user's attention, so suppress the
  // spinner there; we still surface `?` on waiting-input because it's
  // actionable even when focused.
  const showSpinner = status === 'working' && !active
  const showWaiting = status === 'waiting-input'
  const spinner = useBusySpinner(showSpinner)
  const indicator = pickIndicator(showWaiting, showSpinner, spinner)
  const indicatorColor = pickIndicatorColor(theme, { active, showSpinner, showWaiting })
  const labelColor = active
    ? theme.colors['editor.foreground']
    : theme.colors['descriptionForeground']
  const bgColor = dragging || active ? theme.colors['list.activeSelectionBackground'] : undefined

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
      <text fg={indicatorColor} selectable={false}>
        {indicator}{' '}
      </text>
      <text fg={labelColor} selectable={false}>
        [{index}] {session.name}
      </text>
      <text fg={theme.colors['editor.lineHighlightBackground']} selectable={false}>
        {' '}
      </text>
    </box>
  )
}

function pickIndicator(showWaiting: boolean, showSpinner: boolean, spinner: string): string {
  if (showWaiting) return '?'
  if (showSpinner) return spinner
  return '●'
}

function pickIndicatorColor(
  theme: { colors: Record<string, string> },
  flags: { active: boolean; showSpinner: boolean; showWaiting: boolean }
): string {
  if (flags.showWaiting) return theme.colors['editorWarning.foreground'] ?? ''
  if (flags.active || flags.showSpinner) return theme.colors['textLink.foreground'] ?? ''
  return theme.colors['gitDecoration.addedResourceForeground'] ?? ''
}

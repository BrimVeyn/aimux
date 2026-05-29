import type { BoxRenderable, MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { memo, useCallback, useMemo, useRef, useState } from 'react'

import type { SessionRecord, SessionStatus } from '../../../state/types'

import { useAppStore } from '../../../state/app-store'
import { dispatchGlobal, runSideEffectGlobal } from '../../../state/dispatch-ref'
// eslint-disable-next-line no-duplicate-imports
import { IDLE_SESSION_STATUS } from '../../../state/types'
import { useBusySpinner } from '../../hooks/use-busy-spinner'
import { moveIdToIdPosition, orderSessionsForDisplay } from '../../session-ordering'
import { useTheme } from '../../theme'
import { ContextMenuBox } from '../overlays/context-menu/context-menu-box'

interface SessionBarProps {
  forceVisible?: boolean
}

export function SessionBar({ forceVisible = false }: SessionBarProps) {
  const t = useTheme()
  const headerBg = t.backgroundPanel
  const sessions = useAppStore((s) => s.sessions)
  const currentId = useAppStore((s) => s.currentSessionId)
  const bar = useAppStore((s) => s.sessionBar)
  const statusMap = useAppStore((s) => s.sessionStatuses)

  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOrder, setDragOrder] = useState<string[] | null>(null)
  const lastSwapWithRef = useRef<string | null>(null)
  const chipRefs = useRef(new Map<string, BoxRenderable>())

  const ordered = useMemo(() => orderSessionsForDisplay(sessions), [sessions])
  const baselineOrder = useMemo(() => ordered.map((s) => s.id), [ordered])

  const setChipRef = useCallback((id: string, ref: BoxRenderable | null): void => {
    if (ref) chipRefs.current.set(id, ref)
    else chipRefs.current.delete(id)
  }, [])

  const findChipAtX = useCallback((x: number): string | null => {
    for (const [id, ref] of chipRefs.current) {
      if (x >= ref.x && x < ref.x + ref.width) return id
    }
    return null
  }, [])

  const handleMouseDown = useCallback(
    (id: string) => {
      setDraggingId(id)
      setDragOrder(baselineOrder)
      lastSwapWithRef.current = null
    },
    [baselineOrder]
  )

  const handleMouseDrag = useCallback(
    (event: OtuiMouseEvent) => {
      if (!(draggingId != null && draggingId !== '')) return
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
    },
    [draggingId, findChipAtX]
  )

  const commitDrop = useCallback(() => {
    const source = draggingId
    const finalOrder = dragOrder
    setDraggingId(null)
    setDragOrder(null)
    lastSwapWithRef.current = null

    if (source == null || source === '' || !finalOrder) return

    const changed = !arraysEqual(finalOrder, baselineOrder)
    if (changed) {
      dispatchGlobal({ orderedIds: finalOrder, type: 'reorder-sessions' })
      return
    }

    const idx = baselineOrder.indexOf(source)
    if (idx >= 0) {
      runSideEffectGlobal({ index: idx + 1, type: 'switch-session-by-index' })
    }
  }, [baselineOrder, dragOrder, draggingId])

  const cancelDrag = useCallback(() => {
    setDraggingId(null)
    setDragOrder(null)
    lastSwapWithRef.current = null
  }, [])

  const handleNewSession = useCallback((e: OtuiMouseEvent) => {
    e.stopPropagation()
    dispatchGlobal({ returnToSessionPicker: false, type: 'open-create-session-modal' })
  }, [])

  if ((!bar.visible && !forceVisible) || ordered.length === 0) return null

  const visibleSessions =
    dragOrder !== null
      ? dragOrder
          .map((id) => ordered.find((s) => s.id === id))
          .filter((s): s is SessionRecord => !!s)
      : ordered

  return (
    <box
      width="100%"
      flexDirection="row"
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={headerBg}
    >
      {visibleSessions.map((session) => (
        <SessionChip
          key={session.id}
          session={session}
          index={baselineOrder.indexOf(session.id) + 1}
          active={session.id === currentId}
          status={statusMap[session.id] ?? IDLE_SESSION_STATUS}
          dragging={draggingId === session.id}
          setChipRef={setChipRef}
          onDragStart={handleMouseDown}
          onDrag={handleMouseDrag}
          onDrop={commitDrop}
          onDragCancel={cancelDrag}
        />
      ))}
      <box flexGrow={1} />
      <box
        flexDirection="row"
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={t.backgroundElement}
        onMouseDown={handleNewSession}
      >
        <text fg={t.text} selectable={false}>
          + New
        </text>
      </box>
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
  setChipRef: (id: string, ref: BoxRenderable | null) => void
  onDragStart: (id: string) => void
  onDrag: (event: OtuiMouseEvent) => void
  onDrop: () => void
  onDragCancel: () => void
}

const SessionChip = memo(function SessionChip({
  active,
  dragging,
  index,
  onDrag,
  onDragCancel,
  onDragStart,
  onDrop,
  session,
  setChipRef,
  status,
}: SessionChipProps) {
  const t = useTheme()
  const selectionBg = t.backgroundElement
  const showSpinner = status.working
  const showWaiting = status.waiting
  const spinner = useBusySpinner(showSpinner)
  const labelColor = active ? t.text : t.textMuted
  const bgColor = dragging || active ? selectionBg : undefined
  const idleColor = t.success
  const workingColor = t.primary
  const waitingColor = t.warning
  const [hovered, setHovered] = useState(false)

  const handleRef = useCallback(
    (r: BoxRenderable | null) => setChipRef(session.id, r),
    [setChipRef, session.id]
  )
  const handleMouseDown = useCallback(
    (e: OtuiMouseEvent) => {
      e.preventDefault()
      onDragStart(session.id)
    },
    [onDragStart, session.id]
  )
  const handleMouseUp = useCallback(
    (e: OtuiMouseEvent) => {
      e.preventDefault()
      onDrop()
    },
    [onDrop]
  )
  const handleMouseOver = useCallback(() => setHovered(true), [])
  const handleMouseOut = useCallback(() => setHovered(false), [])
  const handleDeleteMouseDown = useCallback(
    (event: OtuiMouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      runSideEffectGlobal({ sessionId: session.id, type: 'delete-session' })
    },
    [session.id]
  )
  const rightClickMenu = useMemo<[string, () => void][]>(
    () => [
      [
        'Rename workspace',
        () =>
          dispatchGlobal({
            initialName: session.name,
            returnToSessionPicker: false,
            sessionTargetId: session.id,
            type: 'open-session-name-modal',
          }),
      ],
      [
        'Delete workspace',
        () => runSideEffectGlobal({ sessionId: session.id, type: 'delete-session' }),
      ],
    ],
    [session.id, session.name]
  )

  return (
    <ContextMenuBox
      ref={handleRef}
      flexDirection="row"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={bgColor}
      rightClickMenu={rightClickMenu}
      onMouseOver={handleMouseOver}
      onMouseOut={handleMouseOut}
      onMouseDown={handleMouseDown}
      onMouseDrag={onDrag}
      onMouseUp={handleMouseUp}
      onMouseDragEnd={onDragCancel}
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
      {hovered ? (
        <box paddingLeft={1} onMouseDown={handleDeleteMouseDown}>
          <text fg={t.textMuted} selectable={false}>
            ×
          </text>
        </box>
      ) : (
        <text fg={t.textMuted} selectable={false}>
          {' '}
        </text>
      )}
    </ContextMenuBox>
  )
})

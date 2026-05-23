import type { BoxRenderable, MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { useMemo, useRef, useState } from 'react'

import type { SessionRecord, SessionStatus } from '../../../state/types'

import { useAppStore } from '../../../state/app-store'
import { dispatchGlobal, runSideEffectGlobal } from '../../../state/dispatch-ref'
import { getActiveWorktree } from '../../../state/session-worktrees'
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
  if ((!bar.visible && !forceVisible) || ordered.length === 0) return null

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
  }

  const commitDrop = () => {
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
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={headerBg}
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
            rightClickMenu={[
              ...buildWorktreeMenu(session),
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
            ]}
          />
        )
      })}
      <box flexGrow={1} />
      <box
        flexDirection="row"
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={t.backgroundElement}
        onMouseDown={(e) => {
          e.stopPropagation()
          dispatchGlobal({ returnToSessionPicker: false, type: 'open-create-session-modal' })
        }}
      >
        <text fg={t.text} selectable={false}>
          + New
        </text>
      </box>
    </box>
  )
}

function buildWorktreeMenu(session: SessionRecord): [string, () => void][] {
  const items: [string, () => void][] = []
  const worktrees = session.worktrees ?? []
  for (const worktree of worktrees) {
    items.push([
      `Switch: ${worktree.branch ?? worktree.name}`,
      () =>
        runSideEffectGlobal({
          sessionId: session.id,
          type: 'switch-worktree',
          worktreeId: worktree.id,
        }),
    ])
  }
  if (items.length > 0) {
    items.push([
      'Fork active worktree',
      () => runSideEffectGlobal({ sessionId: session.id, type: 'fork-worktree' }),
    ])
    const active = getActiveWorktree(session)
    if (active && worktrees.length > 1) {
      items.push([
        active.source === 'aimux-temp' ? 'Delete active temp worktree' : 'Remove active worktree',
        () =>
          runSideEffectGlobal({
            sessionId: session.id,
            type: 'delete-worktree',
            worktreeId: active.id,
          }),
      ])
    }
  }
  return items
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
  rightClickMenu: [string, () => void][]
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
  rightClickMenu,
  session,
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

  return (
    <ContextMenuBox
      ref={onRef}
      flexDirection="row"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={bgColor}
      rightClickMenu={rightClickMenu}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
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
      {hovered ? (
        <box
          paddingLeft={1}
          onMouseDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
            runSideEffectGlobal({ sessionId: session.id, type: 'delete-session' })
          }}
        >
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
}

import type {
  BoxRenderable,
  MouseEvent as OtuiMouseEvent,
  ScrollBoxRenderable,
} from '@opentui/core'

import { memo, type ReactNode, useCallback, useMemo, useRef, useState } from 'react'

import type { SessionRecord, SessionStatus, WorktreeRecord } from '../../../../state/types'

import { useAppStore } from '../../../../state/app-store'
import { dispatchGlobal, runSideEffectGlobal } from '../../../../state/dispatch-ref'
import { formatDivergence, getWorktreeColor } from '../../../../state/session-worktrees'
// eslint-disable-next-line no-duplicate-imports
import { IDLE_SESSION_STATUS } from '../../../../state/types'
import { useBusySpinner } from '../../../hooks/use-busy-spinner'
import { moveIdToIdPosition, orderSessionsForDisplay } from '../../../session-ordering'
import { useTheme } from '../../../theme'
import { ContextMenuBox } from '../../overlays/context-menu/context-menu-box'
import { useSidebarAutoScroll } from './use-sidebar-auto-scroll'
import { WorktreeRow } from './worktree-row'

interface WorkspaceListProps {
  contentWidth: number
}

const COLUMN_CONTENT_OPTIONS = { flexDirection: 'column' as const, gap: 0 }

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function truncate(label: string, max: number): string {
  if (max <= 0) return ''
  if (label.length <= max) return label
  if (max === 1) return '…'
  return `${label.slice(0, max - 1)}…`
}

export function WorkspaceList({ contentWidth }: WorkspaceListProps) {
  const t = useTheme()
  const sessions = useAppStore((s) => s.sessions)
  const currentSessionId = useAppStore((s) => s.currentSessionId)
  const statusMap = useAppStore((s) => s.sessionStatuses)

  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOrder, setDragOrder] = useState<string[] | null>(null)
  const lastSwapWithRef = useRef<string | null>(null)
  const rowRefs = useRef(new Map<string, BoxRenderable>())
  const scrollRef = useRef<ScrollBoxRenderable | null>(null)

  const ordered = useMemo(() => orderSessionsForDisplay(sessions), [sessions])
  const baselineOrder = useMemo(() => ordered.map((s) => s.id), [ordered])

  const currentSession = useMemo(
    () =>
      currentSessionId != null && currentSessionId !== ''
        ? sessions.find((s) => s.id === currentSessionId)
        : undefined,
    [currentSessionId, sessions]
  )
  // The active row can be either a worktree row OR the workspace row
  // (when the primary worktree is active). Both must scroll into view —
  // otherwise the cursor visually "disappears" off-screen when crossing
  // a workspace boundary on a key press.
  const currentWorktrees = currentSession?.worktrees ?? []
  const currentPrimary = currentWorktrees.find((w) => w.source === 'primary') ?? currentWorktrees[0]
  const rawActiveWorktreeId = currentSession?.activeWorktreeId
  const activeOnNonPrimary =
    rawActiveWorktreeId != null &&
    rawActiveWorktreeId !== '' &&
    rawActiveWorktreeId !== currentPrimary?.id
  let activeRowId: string | null = null
  if (activeOnNonPrimary) {
    activeRowId = `sidebar-wt-${rawActiveWorktreeId}`
  } else if (currentSessionId != null && currentSessionId !== '') {
    activeRowId = `sidebar-ws-${currentSessionId}`
  }

  useSidebarAutoScroll({
    activeRowId,
    scrollRef,
    visible: true,
  })

  const setRowRef = useCallback((id: string, ref: BoxRenderable | null): void => {
    if (ref) rowRefs.current.set(id, ref)
    else rowRefs.current.delete(id)
  }, [])

  const findRowAtY = useCallback((y: number): string | null => {
    for (const [id, ref] of rowRefs.current) {
      if (y >= ref.y && y < ref.y + ref.height) return id
    }
    return null
  }, [])

  const handleRowDragStart = useCallback(
    (id: string) => {
      setDraggingId(id)
      setDragOrder(baselineOrder)
      lastSwapWithRef.current = null
    },
    [baselineOrder]
  )

  const handleRowDrag = useCallback(
    (event: OtuiMouseEvent) => {
      if (!(draggingId != null && draggingId !== '')) return
      const hit = findRowAtY(event.y)
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
    [draggingId, findRowAtY]
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
    e.preventDefault()
    dispatchGlobal({ returnToSessionPicker: false, type: 'open-create-session-modal' })
  }, [])

  const visibleSessions =
    dragOrder !== null
      ? dragOrder
          .map((id) => ordered.find((s) => s.id === id))
          .filter((s): s is SessionRecord => !!s)
      : ordered

  return (
    <box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
      <scrollbox
        ref={scrollRef}
        scrollY
        flexGrow={1}
        flexShrink={1}
        contentOptions={COLUMN_CONTENT_OPTIONS}
      >
        {(() => {
          // Build a single flat list of items — workspace rows interleaved
          // with their non-primary worktrees. One map, one React keypath per
          // visible row; transitions are a single atomic reconciliation.
          const rows: ReactNode[] = []
          for (const [visibleIdx, session] of visibleSessions.entries()) {
            const sessionIndex = baselineOrder.indexOf(session.id) + 1
            const isCurrentSession = session.id === currentSessionId
            const worktrees = session.worktrees ?? []
            const primaryWorktree = worktrees.find((w) => w.source === 'primary') ?? worktrees[0]
            const extraWorktrees = worktrees.filter((w) => w.id !== primaryWorktree?.id)
            const workspaceIsActiveItem =
              isCurrentSession &&
              (session.activeWorktreeId == null ||
                session.activeWorktreeId === '' ||
                session.activeWorktreeId === primaryWorktree?.id)
            rows.push(
              <WorkspaceRow
                key={`ws:${session.id}`}
                session={session}
                isActiveItem={workspaceIsActiveItem}
                inCurrentGroup={isCurrentSession}
                primaryWorktree={primaryWorktree}
                status={statusMap[session.id] ?? IDLE_SESSION_STATUS}
                dragging={draggingId === session.id}
                contentWidth={contentWidth}
                marginTop={visibleIdx > 0 ? 1 : 0}
                setRowRef={setRowRef}
                onDragStart={handleRowDragStart}
                onDrag={handleRowDrag}
                onDrop={commitDrop}
                onDragCancel={cancelDrag}
              />
            )
            for (const worktree of extraWorktrees) {
              rows.push(
                <WorktreeRow
                  key={`wt:${worktree.id}`}
                  session={session}
                  worktree={worktree}
                  sessionIndex={sessionIndex}
                  isActiveItem={isCurrentSession && worktree.id === session.activeWorktreeId}
                  inCurrentGroup={isCurrentSession}
                />
              )
            }
          }
          return rows
        })()}
      </scrollbox>
      <box
        flexDirection="row"
        flexShrink={0}
        marginTop={1}
        backgroundColor={t.backgroundPanel}
        justifyContent="center"
        onMouseDown={handleNewSession}
      >
        <text fg={t.text} selectable={false}>
          + New workspace
        </text>
      </box>
    </box>
  )
}

interface WorkspaceRowProps {
  session: SessionRecord
  /** True when this row is the active cursor item (workspace's primary active). */
  isActiveItem: boolean
  /** True when this row belongs to the current workspace (selection scope). */
  inCurrentGroup: boolean
  /** The session's primary worktree — its git branch is shown as the workspace's anchor identity. */
  primaryWorktree: WorktreeRecord | undefined
  status: SessionStatus
  dragging: boolean
  contentWidth: number
  /** Vertical spacing above this row — used to separate workspace blocks. */
  marginTop: number
  setRowRef: (id: string, ref: BoxRenderable | null) => void
  onDragStart: (id: string) => void
  onDrag: (event: OtuiMouseEvent) => void
  onDrop: () => void
  onDragCancel: () => void
}

const WorkspaceRow = memo(function WorkspaceRow({
  contentWidth,
  dragging,
  inCurrentGroup,
  isActiveItem,
  marginTop,
  onDrag,
  onDragCancel,
  onDragStart,
  onDrop,
  primaryWorktree,
  session,
  setRowRef,
  status,
}: WorkspaceRowProps) {
  const t = useTheme()
  const showSpinner = status.working
  const showWaiting = status.waiting
  const spinner = useBusySpinner(showSpinner)
  let bgColor: string | undefined
  if (dragging || isActiveItem) {
    bgColor = t.backgroundElement
  } else if (inCurrentGroup) {
    bgColor = t.backgroundPanel
  }
  const workingColor = t.primary
  const waitingColor = t.warning
  const divergence = useAppStore((s) =>
    primaryWorktree ? s.worktreeDivergence[primaryWorktree.id] : undefined
  )

  const handleRef = useCallback(
    (r: BoxRenderable | null) => setRowRef(session.id, r),
    [setRowRef, session.id]
  )
  const handleMouseDown = useCallback(
    (e: OtuiMouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
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

  // Color of the left vertical bar — the workspace's stable accent (derived
  // from its primary worktree id). Falls back to a tint for unhydrated sessions.
  const barColor =
    primaryWorktree != null
      ? (primaryWorktree.color ?? getWorktreeColor(primaryWorktree.id))
      : t.textMuted
  // Working/waiting indicator overrides the colored bar — the user needs to
  // see assistant activity from across the room.
  let leadingGlyph = '▍'
  let leadingColor = barColor
  if (showWaiting) {
    leadingGlyph = '?'
    leadingColor = waitingColor
  } else if (showSpinner) {
    leadingGlyph = spinner
    leadingColor = workingColor
  }

  const branchText = primaryWorktree?.branch ?? ''
  const divergenceText = formatDivergence(divergence)
  const showBranch = branchText !== ''
  const nameLabel = truncate(session.name, Math.max(0, contentWidth - 4))
  const branchLabel = truncate(
    branchText,
    Math.max(0, contentWidth - 5 - (divergenceText.length + 1))
  )

  // Tail divider: fill the rest of the workspace row with `─` so the eye can
  // separate workspace blocks at a glance. Length is total width minus
  // glyph(1) + ` `(1) + name + ` `(1) before the dashes.
  const fillWidth = Math.max(0, contentWidth - (1 + 1 + nameLabel.length + 1))

  return (
    <ContextMenuBox
      ref={handleRef}
      id={`sidebar-ws-${session.id}`}
      flexDirection="column"
      flexShrink={0}
      marginTop={marginTop}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={bgColor}
      rightClickMenu={rightClickMenu}
      onMouseDown={handleMouseDown}
      onMouseDrag={onDrag}
      onMouseUp={handleMouseUp}
      onMouseDragEnd={onDragCancel}
    >
      <box flexDirection="row" alignItems="center">
        <text fg={leadingColor} selectable={false} wrapMode="none">
          {leadingGlyph}
        </text>
        <text fg={isActiveItem ? t.text : t.textMuted} selectable={false} wrapMode="none">
          {' '}
          {nameLabel}
        </text>
        {fillWidth > 0 ? (
          <text fg={t.textMuted} selectable={false} wrapMode="none">
            {' '}
            {'─'.repeat(fillWidth)}
          </text>
        ) : null}
      </box>
      {showBranch ? (
        <box flexDirection="row">
          <text fg={t.textMuted} selectable={false} wrapMode="none">
            {'  '}
            {'\u{e702}'} {branchLabel}
            {divergenceText !== '' ? ` ${divergenceText}` : ''}
          </text>
        </box>
      ) : null}
    </ContextMenuBox>
  )
})

import type {
  BoxRenderable,
  MouseEvent as OtuiMouseEvent,
  ScrollBoxRenderable,
} from '@opentui/core'

import { memo, useCallback, useMemo, useRef, useState } from 'react'

import type { SessionRecord, SessionStatus, WorktreeRecord } from '../../../../state/types'

import { useAppStore } from '../../../../state/app-store'
import { dispatchGlobal, runSideEffectGlobal } from '../../../../state/dispatch-ref'
// eslint-disable-next-line no-duplicate-imports
import { IDLE_SESSION_STATUS } from '../../../../state/types'
import { useBusySpinner } from '../../../hooks/use-busy-spinner'
import { moveIdToIdPosition, orderSessionsForDisplay } from '../../../session-ordering'
import { useTheme } from '../../../theme'
import { ContextMenuBox } from '../../overlays/context-menu/context-menu-box'
import { formatDivergence } from '../../worktree/worktree-chip'
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
  const activeWorktreeId = currentSession?.activeWorktreeId ?? null

  useSidebarAutoScroll({
    activeWorktreeId,
    idPrefix: 'sidebar-wt-',
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
        {visibleSessions.map((session, visibleIdx) => {
          const sessionIndex = baselineOrder.indexOf(session.id) + 1
          const isCurrentSession = session.id === currentSessionId
          const worktrees = session.worktrees ?? []
          // The primary worktree's branch is shown inline on the WorkspaceRow
          // itself — no separate row for it. Extra worktrees (aimux-temp or
          // external) get their own indented chip rows underneath.
          const primaryWorktree = worktrees.find((w) => w.source === 'primary') ?? worktrees[0]
          const extraWorktrees = worktrees.filter((w) => w.id !== primaryWorktree?.id)
          const sessionActiveWorktreeId = session.activeWorktreeId
          return (
            <box
              key={session.id}
              flexDirection="column"
              flexShrink={0}
              marginTop={visibleIdx > 0 ? 1 : 0}
            >
              <WorkspaceRow
                session={session}
                index={sessionIndex}
                active={isCurrentSession}
                primaryWorktree={primaryWorktree}
                status={statusMap[session.id] ?? IDLE_SESSION_STATUS}
                dragging={draggingId === session.id}
                contentWidth={contentWidth}
                setRowRef={setRowRef}
                onDragStart={handleRowDragStart}
                onDrag={handleRowDrag}
                onDrop={commitDrop}
                onDragCancel={cancelDrag}
              />
              {extraWorktrees.map((worktree) => (
                <WorktreeRow
                  key={worktree.id}
                  session={session}
                  worktree={worktree}
                  sessionIndex={sessionIndex}
                  active={isCurrentSession && worktree.id === sessionActiveWorktreeId}
                />
              ))}
            </box>
          )
        })}
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
  index: number
  active: boolean
  /** The session's primary worktree — its git branch is shown as the workspace's anchor identity. */
  primaryWorktree: WorktreeRecord | undefined
  status: SessionStatus
  dragging: boolean
  contentWidth: number
  setRowRef: (id: string, ref: BoxRenderable | null) => void
  onDragStart: (id: string) => void
  onDrag: (event: OtuiMouseEvent) => void
  onDrop: () => void
  onDragCancel: () => void
}

const WorkspaceRow = memo(function WorkspaceRow({
  active,
  contentWidth,
  dragging,
  index,
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
  const bgColor = dragging || active ? t.backgroundElement : undefined
  const idleColor = t.success
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

  // Status glyph
  let statusGlyph: ReturnType<typeof renderGlyph>
  if (showWaiting) {
    statusGlyph = renderGlyph('?', waitingColor)
  } else if (showSpinner) {
    statusGlyph = renderGlyph(spinner, workingColor)
  } else {
    statusGlyph = renderGlyph('●', active ? workingColor : idleColor)
  }

  const indexLabel = `[${index}]`
  const branchText = primaryWorktree?.branch ?? ''
  const divergenceText = formatDivergence(divergence)
  // Single dense line: ● [N] name  ⎇ branch ↑↓
  // Chrome cost: 1 glyph + ` [N]` (3-4) + ` ` + ` ⎇ ` (3) + ` ` + divergence
  const fixedChrome = 1 + indexLabel.length + 1 + (branchText !== '' ? 4 : 0)
  const divergenceWidth = divergenceText !== '' ? divergenceText.length + 1 : 0
  const available = Math.max(0, contentWidth - fixedChrome - divergenceWidth)
  // Give the branch a slight edge — it's the volatile git state, the name
  // is recognizable from a prefix.
  const branchBudget = branchText !== '' ? Math.max(6, Math.floor(available * 0.55)) : 0
  const nameBudget = Math.max(0, available - branchBudget)
  const nameLabel = truncate(session.name, nameBudget)
  const branchLabel = truncate(branchText, branchBudget)
  const showBranch = branchLabel !== ''

  return (
    <ContextMenuBox
      ref={handleRef}
      flexDirection="row"
      alignItems="center"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={bgColor}
      rightClickMenu={rightClickMenu}
      onMouseDown={handleMouseDown}
      onMouseDrag={onDrag}
      onMouseUp={handleMouseUp}
      onMouseDragEnd={onDragCancel}
    >
      {statusGlyph}
      <text fg={t.textMuted} selectable={false} wrapMode="none">
        {' '}
        {indexLabel}
      </text>
      <text fg={active ? t.text : t.textMuted} selectable={false} wrapMode="none">
        {' '}
        {nameLabel}
      </text>
      {showBranch ? (
        <>
          <text fg={t.textMuted} selectable={false} wrapMode="none">
            {' '}
            {'\u{e702}'}{' '}
          </text>
          <text fg={t.text} selectable={false} wrapMode="none">
            {branchLabel}
          </text>
          {divergenceText !== '' ? (
            <text fg={t.textMuted} selectable={false} wrapMode="none">
              {' '}
              {divergenceText}
            </text>
          ) : null}
        </>
      ) : null}
    </ContextMenuBox>
  )
})

function renderGlyph(glyph: string, color: string) {
  return (
    <text fg={color} selectable={false}>
      {glyph}
    </text>
  )
}

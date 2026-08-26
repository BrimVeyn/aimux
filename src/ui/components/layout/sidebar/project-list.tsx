import type {
  BoxRenderable,
  MouseEvent as OtuiMouseEvent,
  ScrollBoxRenderable,
} from '@opentui/core'

import { memo, type ReactNode, useCallback, useMemo, useRef, useState } from 'react'

import type { ProjectRecord, ProjectStatus } from '../../../../state/types'

import { useAppStore } from '../../../../state/app-store'
import { dispatchGlobal, runSideEffectGlobal } from '../../../../state/dispatch-ref'
import { getPrimaryWorkspace } from '../../../../state/project-workspaces'
// eslint-disable-next-line no-duplicate-imports
import { IDLE_PROJECT_STATUS } from '../../../../state/types'
import { moveIdToInsertIndex, orderProjectsForDisplay } from '../../../project-ordering'
import { useBaseTheme, useTheme } from '../../../theme'
import { truncate } from '../../../truncate'
import { FlashLabelBadge } from '../../flash/flash-label-badge'
import { ContextMenuBox } from '../../overlays/context-menu/context-menu-box'
import { useSidebarAutoScroll } from './use-sidebar-auto-scroll'
import { WorkspaceRow } from './workspace-row'

interface ProjectListProps {
  contentWidth: number
}

const COLUMN_CONTENT_OPTIONS = { flexDirection: 'column' as const, gap: 0 }

const RULE = '─'
/** Heavier than the chrome rules, so the drop preview never reads as a border. */
const DROP_BAR = '━'
const HEADER_TITLE = 'Projects'

interface DragState {
  id: string
  /** Gap the drop would land in, or null while the pointer is off the list. */
  dropIndex: number | null
}

export function ProjectList({ contentWidth }: ProjectListProps) {
  const t = useTheme()
  const projects = useAppStore((s) => s.projects)
  const currentProjectId = useAppStore((s) => s.currentProjectId)
  const statusMap = useAppStore((s) => s.projectStatuses)

  // The drag lives in a ref because mouse events can arrive before React has
  // committed the state they set — reading `draggingId` out of a handler
  // closure saw `null` for the whole gesture. The two state copies below exist
  // only so the row highlight and the drop bar redraw.
  const dragRef = useRef<DragState | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  // Where the drop would land, as a gap index (0 = above the first project,
  // projects.length = below the last). The list itself never moves while
  // dragging — only this bar does, so rows can't slide out from under the
  // pointer and make the drag oscillate.
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const gapRefs = useRef(new Map<number, BoxRenderable>())
  const scrollRef = useRef<ScrollBoxRenderable | null>(null)

  const ordered = useMemo(() => orderProjectsForDisplay(projects), [projects])
  const baselineOrder = useMemo(() => ordered.map((s) => s.id), [ordered])

  const currentProject = useMemo(
    () =>
      currentProjectId != null && currentProjectId !== ''
        ? projects.find((s) => s.id === currentProjectId)
        : undefined,
    [currentProjectId, projects]
  )
  // The cursor is always on a workspace row now, so there is one id to scroll
  // to instead of two — otherwise it visually "disappears" off-screen when a
  // key press crosses a project boundary.
  const rawActiveWorkspaceId = currentProject?.activeWorkspaceId
  const activeWorkspaceId =
    rawActiveWorkspaceId != null && rawActiveWorkspaceId !== ''
      ? rawActiveWorkspaceId
      : getPrimaryWorkspace(currentProject?.workspaces)?.id
  const activeRowId =
    activeWorkspaceId != null && activeWorkspaceId !== '' ? `sidebar-wt-${activeWorkspaceId}` : null

  useSidebarAutoScroll({
    activeRowId,
    scrollRef,
    visible: true,
  })

  const setGapRef = useCallback((index: number, ref: BoxRenderable | null): void => {
    if (ref) gapRefs.current.set(index, ref)
    else gapRefs.current.delete(index)
  }, [])

  // The gaps *are* the insertion points, so the nearest one to the pointer is
  // the drop slot — no row-height arithmetic, which matters because a workspace
  // row is one line or two depending on whether it has a branch.
  const findDropIndex = useCallback((event: OtuiMouseEvent): number | null => {
    const box = scrollRef.current
    if (box && (event.x < box.x || event.x >= box.x + box.width)) return null
    let best: number | null = null
    let bestDistance = Number.POSITIVE_INFINITY
    for (const [index, ref] of gapRefs.current) {
      const distance = Math.abs(event.y - ref.y)
      if (distance < bestDistance) {
        bestDistance = distance
        best = index
      }
    }
    return best
  }, [])

  const handleRowDragStart = useCallback((id: string) => {
    dragRef.current = { dropIndex: null, id }
    setDraggingId(id)
    setDropIndex(null)
  }, [])

  const handleDrag = useCallback(
    (event: OtuiMouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      drag.dropIndex = findDropIndex(event)
      setDropIndex(drag.dropIndex)
    },
    [findDropIndex]
  )

  // Bound to both `up` and `drag-end`: a plain click only ever sends `up`,
  // while a released drag sends `drag-end` first. Clearing the ref makes the
  // second one a no-op, so either order does the same thing once.
  const commitDrop = useCallback(() => {
    const drag = dragRef.current
    dragRef.current = null
    setDraggingId(null)
    setDropIndex(null)

    if (!drag) return
    const source = drag.id

    if (drag.dropIndex !== null) {
      const nextOrder = moveIdToInsertIndex(baselineOrder, source, drag.dropIndex)
      // Identity means the drop landed back where it started — a released drag,
      // not a click, so it must not fall through to switching project.
      if (nextOrder !== baselineOrder) {
        dispatchGlobal({ orderedIds: nextOrder, type: 'reorder-projects' })
      }
      return
    }

    const idx = baselineOrder.indexOf(source)
    if (idx >= 0) {
      // The heading stands for the project itself, not for whichever workspace
      // was last active in it, so clicking it lands on the checkout — the one
      // workspace every project is guaranteed to have.
      const sourceProject = ordered.find((s) => s.id === source)
      const sourceWorkspaces = sourceProject?.workspaces ?? []
      const sourcePrimaryId = getPrimaryWorkspace(sourceWorkspaces)?.id
      runSideEffectGlobal({
        index: idx + 1,
        type: 'switch-project-by-index',
        workspaceId: sourcePrimaryId,
      })
    }
  }, [baselineOrder, ordered])

  const handleNewProject = useCallback((e: OtuiMouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    dispatchGlobal({ returnToProjectPicker: false, type: 'open-create-project-modal' })
  }, [])

  const rule = RULE.repeat(Math.max(1, contentWidth))

  return (
    // Drag and release are handled here, not on the row that started them:
    // opentui captures the pointer at the first drag event, wherever it lands,
    // and a one-line heading is left the moment the pointer moves down. Any row
    // that captures is a descendant of this box, so the events bubble here.
    <box
      flexDirection="column"
      flexGrow={1}
      flexShrink={1}
      overflow="hidden"
      onMouseDrag={handleDrag}
      onMouseUp={commitDrop}
      onMouseDragEnd={commitDrop}
    >
      <box flexShrink={0}>
        <text fg={t.border} selectable={false} wrapMode="none">
          {rule}
        </text>
      </box>
      <box flexDirection="row" flexShrink={0} paddingLeft={1} paddingRight={1}>
        <text fg={t.text} selectable={false} wrapMode="none">
          {HEADER_TITLE}
        </text>
        <box flexGrow={1} flexShrink={1} />
        <text fg={t.textMuted} selectable={false} wrapMode="none" onMouseDown={handleNewProject}>
          +
        </text>
      </box>
      <scrollbox
        ref={scrollRef}
        scrollY
        flexGrow={1}
        flexShrink={1}
        contentOptions={COLUMN_CONTENT_OPTIONS}
      >
        {(() => {
          // Build a single flat list — each project's heading followed by every
          // one of its workspaces. One map, one React keypath per visible row;
          // transitions are a single atomic reconciliation.
          const rows: ReactNode[] = []
          for (const [index, project] of ordered.entries()) {
            const projectIndex = index + 1
            const isCurrentProject = project.id === currentProjectId
            const workspaces = project.workspaces ?? []
            // Every workspace gets a row, the checkout included. Folding it into
            // the project row made one row mean two things — a project you
            // switch to and a workspace you run tabs in — and left the checkout
            // the only workspace with no branch and no churn on screen.
            const activeWorkspaceId =
              project.activeWorkspaceId != null && project.activeWorkspaceId !== ''
                ? project.activeWorkspaceId
                : getPrimaryWorkspace(workspaces)?.id
            rows.push(
              // Every project already had a blank line above it, which doubles
              // as the gap under the header. The drop bar is drawn *in* that
              // line, so previewing a slot never shifts a single row.
              <DropGap
                key={`gap:${project.id}`}
                index={index}
                active={dropIndex === index}
                contentWidth={contentWidth}
                setGapRef={setGapRef}
              />
            )
            rows.push(
              <ProjectRow
                key={`ws:${project.id}`}
                project={project}
                inCurrentGroup={isCurrentProject}
                projectIndex={projectIndex}
                status={statusMap[project.id] ?? IDLE_PROJECT_STATUS}
                dragging={draggingId === project.id}
                contentWidth={contentWidth}
                onDragStart={handleRowDragStart}
              />
            )
            for (const workspace of workspaces) {
              rows.push(
                <WorkspaceRow
                  key={`wt:${workspace.id}`}
                  project={project}
                  workspace={workspace}
                  projectIndex={projectIndex}
                  isActiveItem={isCurrentProject && workspace.id === activeWorkspaceId}
                  inCurrentGroup={isCurrentProject}
                  contentWidth={contentWidth}
                />
              )
            }
          }
          // Trailing slot, so "after the last project" is reachable.
          rows.push(
            <DropGap
              key="gap:end"
              index={ordered.length}
              active={dropIndex === ordered.length}
              contentWidth={contentWidth}
              setGapRef={setGapRef}
            />
          )
          return rows
        })()}
      </scrollbox>
    </box>
  )
}

interface DropGapProps {
  /** Insertion slot this gap stands for: 0 is above the first project. */
  index: number
  active: boolean
  contentWidth: number
  setGapRef: (index: number, ref: BoxRenderable | null) => void
}

/** The one-line gap above a project — blank, or the drop preview mid-drag. */
function DropGap({ active, contentWidth, index, setGapRef }: DropGapProps) {
  const t = useTheme()
  const handleRef = useCallback(
    (r: BoxRenderable | null) => setGapRef(index, r),
    [setGapRef, index]
  )
  return (
    <box ref={handleRef} flexShrink={0} height={1}>
      {active ? (
        <text fg={t.primary} selectable={false} wrapMode="none">
          {DROP_BAR.repeat(Math.max(1, contentWidth))}
        </text>
      ) : null}
    </box>
  )
}

interface ProjectRowProps {
  project: ProjectRecord
  /**
   * True when this row belongs to the current project (selection scope).
   *
   * There is deliberately no `isActiveItem`: the cursor lives on workspace
   * rows, and this row is the heading they sit under.
   */
  inCurrentGroup: boolean
  /** 1-based index in the visible order, so the "+" can switch projects first. */
  projectIndex: number
  status: ProjectStatus
  dragging: boolean
  contentWidth: number
  /** Only the gesture's start lives here — the list owns drag and release. */
  onDragStart: (id: string) => void
}

const ProjectRow = memo(function ProjectRow({
  contentWidth,
  dragging,
  inCurrentGroup,
  onDragStart,
  project,
  projectIndex,
  status,
}: ProjectRowProps) {
  const t = useTheme()
  // Selection highlight must stay opaque in transparent mode — otherwise the
  // cursor row visually disappears against the see-through chrome.
  const base = useBaseTheme()
  // State belongs on the workspace rows: they say *which* one is working or
  // waiting, and this heading can only say "somewhere below". So the heading
  // speaks only when none of its workspaces can — a tab whose workspace this
  // client doesn't know, which today means a daemon still running a pre-v18
  // protocol. Without that fallback the sidebar would go silent instead of
  // degrading.
  const workspacesSpeak = useAppStore((s) =>
    (project.workspaces ?? []).some((workspace) => {
      const activity = s.workspaceActivity[workspace.id]
      return activity !== undefined && (activity.working || activity.waiting || activity.done)
    })
  )
  const showWaiting = status.waiting && !workspacesSpeak
  // Only the drag highlight is "selected"-strength here. A heading that lights
  // up like a cursor row is what made the project look like a workspace.
  let bgColor: string | undefined
  if (dragging) {
    bgColor = base.backgroundElement
  } else if (inCurrentGroup) {
    bgColor = base.backgroundPanel
  }
  const waitingColor = t.warning
  const currentProjectId = useAppStore((s) => s.currentProjectId)

  const handleMouseDown = useCallback(
    (e: OtuiMouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      onDragStart(project.id)
    },
    [onDragStart, project.id]
  )
  const handleNewWorkspace = useCallback(
    (e: OtuiMouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      // The modal always targets the current project, so make this one current
      // first. Both run through the store synchronously, so the branch load
      // below already sees the switch.
      if (project.id !== currentProjectId) {
        runSideEffectGlobal({ index: projectIndex, type: 'switch-project-by-index' })
      }
      dispatchGlobal({ type: 'open-create-workspace-modal' })
      runSideEffectGlobal({ type: 'load-create-workspace-base-branches' })
    },
    [currentProjectId, project.id, projectIndex]
  )
  const rightClickMenu = useMemo<[string, () => void][]>(
    () => [
      [
        'Rename project',
        () =>
          dispatchGlobal({
            initialName: project.name,
            projectTargetId: project.id,
            returnToProjectPicker: false,
            type: 'open-project-name-modal',
          }),
      ],
      [
        'Delete project',
        () => runSideEffectGlobal({ projectId: project.id, type: 'delete-project' }),
      ],
    ],
    [project.id, project.name]
  )

  // Neutral muted marker, and a question when a workspace of this project needs
  // an answer. No progress indicator: a heading can only say "somewhere below",
  // and the row that actually knows is one line down. Keeping a glyph in the slot
  // avoids name shifts when the question comes and goes — which is also why the
  // gap after it is part of the glyph.
  let leadingGlyph = '• '
  let leadingColor = t.textMuted
  if (showWaiting) {
    leadingGlyph = '? '
    leadingColor = waitingColor
  }

  // No branch line: the repo checkout is not somewhere aimux works, so naming
  // it under every project only ever read as "you are on main".
  const nameLabel = truncate(project.name, Math.max(0, contentWidth - 6))

  return (
    <ContextMenuBox
      id={`sidebar-ws-${project.id}`}
      flexDirection="column"
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={bgColor}
      rightClickMenu={rightClickMenu}
      onMouseDown={handleMouseDown}
    >
      <box flexDirection="row" alignItems="center">
        <text fg={leadingColor} selectable={false} wrapMode="none">
          {leadingGlyph}
        </text>
        <FlashLabelBadge rowKey={`ws:${project.id}`} />
        <text fg={t.text} selectable={false} wrapMode="none">
          {nameLabel}
        </text>
        <box flexGrow={1} flexShrink={1} />
        <text fg={t.textMuted} selectable={false} wrapMode="none" onMouseDown={handleNewWorkspace}>
          +
        </text>
      </box>
    </ContextMenuBox>
  )
})

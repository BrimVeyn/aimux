import type {
  BoxRenderable,
  MouseEvent as OtuiMouseEvent,
  ScrollBoxRenderable,
} from '@opentui/core'

import { memo, type ReactNode, useCallback, useMemo, useRef, useState } from 'react'

import type { ProjectRecord } from '../../../../state/types'

import { useAppStore } from '../../../../state/app-store'
import { dispatchGlobal, runSideEffectGlobal } from '../../../../state/dispatch-ref'
import {
  getActiveWorkspace,
  getPrimaryWorkspace,
  getSidebarWorkspaces,
} from '../../../../state/project-workspaces'
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

/** Heavier than the chrome rules, so the drop preview never reads as a border. */
const DROP_BAR = '━'
const HEADER_TITLE = 'Projects'
/** Same pair the git panel folds its directories with, so the gesture reads once. */
const COLLAPSED_GLYPH = '▸ '
const EXPANDED_GLYPH = '▾ '

interface DragState {
  id: string
  /** Gap the drop would land in, or null while the pointer is off the list. */
  dropIndex: number | null
}

export function ProjectList({ contentWidth }: ProjectListProps) {
  const t = useTheme()
  const projects = useAppStore((s) => s.projects)
  const currentProjectId = useAppStore((s) => s.currentProjectId)

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
  const activeWorkspaceId = getActiveWorkspace(currentProject)?.id
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
      {/* No rule above the heading: the bar draws its own seams, full width,
          and this widget is not always the one at the top. */}
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
            // Every workspace gets a row, the checkout included. Folding it into
            // the project row made one row mean two things — a project you
            // switch to and a workspace you run tabs in — and left the checkout
            // the only workspace with no branch and no churn on screen.
            const activeWorkspaceId = getActiveWorkspace(project)?.id
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
                projectIndex={projectIndex}
                dragging={draggingId === project.id}
                contentWidth={contentWidth}
                onDragStart={handleRowDragStart}
              />
            )
            for (const workspace of getSidebarWorkspaces(project, isCurrentProject)) {
              rows.push(
                <WorkspaceRow
                  key={`wt:${workspace.id}`}
                  project={project}
                  workspace={workspace}
                  projectIndex={projectIndex}
                  isActiveItem={isCurrentProject && workspace.id === activeWorkspaceId}
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
  /** 1-based index in the visible order, so the "+" can switch projects first. */
  projectIndex: number
  dragging: boolean
  contentWidth: number
  /** Only the gesture's start lives here — the list owns drag and release. */
  onDragStart: (id: string) => void
}

const ProjectRow = memo(function ProjectRow({
  contentWidth,
  dragging,
  onDragStart,
  project,
  projectIndex,
}: ProjectRowProps) {
  const t = useTheme()
  // Selection highlight must stay opaque in transparent mode — otherwise the
  // cursor row visually disappears against the see-through chrome.
  const base = useBaseTheme()
  // Only the drag highlight is "selected"-strength here. A heading that lights
  // up like a cursor row is what made the project look like a workspace.
  // No band for "this row's project is the current one": the bar is a single
  // backgroundPanel surface now and backgroundElement is spoken for by the
  // cursor row, which leaves no third tone that works in every theme. The
  // cursor row — one step off the panel, plus its accent bar — is what says
  // where you are; the group it sits in follows from that.
  const bgColor = dragging ? base.backgroundElement : undefined
  const currentProjectId = useAppStore((s) => s.currentProjectId)

  const handleMouseDown = useCallback(
    (e: OtuiMouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      onDragStart(project.id)
    },
    [onDragStart, project.id]
  )
  // stopPropagation keeps the row's own mousedown from starting a drag, so the
  // release never falls through to switching project — same trick as the "+".
  const handleToggleCollapsed = useCallback(
    (e: OtuiMouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      runSideEffectGlobal({ projectId: project.id, type: 'toggle-project-collapsed' })
    },
    [project.id]
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

  // The slot used to carry a status marker, which only ever said "somewhere
  // below" — the workspace rows one line down say it precisely. It now carries
  // the fold arrow instead, and the trailing space is part of the glyph so the
  // name never shifts.
  const leadingGlyph = project.collapsed === true ? COLLAPSED_GLYPH : EXPANDED_GLYPH

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
        <text
          fg={t.textMuted}
          selectable={false}
          wrapMode="none"
          onMouseDown={handleToggleCollapsed}
        >
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

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
import { useBusySpinner } from '../../../hooks/use-busy-spinner'
import { moveIdToIdPosition, orderProjectsForDisplay } from '../../../project-ordering'
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
const HEADER_TITLE = 'Projects'
/**
 * U+2699, not the nerd-font gear: its Emoji_Presentation is No, so a conforming
 * terminal draws it text-style in one cell and no font has to be installed for
 * the one button that opens the settings.
 */
const SETTINGS_GLYPH = '⚙'

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

export function ProjectList({ contentWidth }: ProjectListProps) {
  const t = useTheme()
  const projects = useAppStore((s) => s.projects)
  const currentProjectId = useAppStore((s) => s.currentProjectId)
  const statusMap = useAppStore((s) => s.projectStatuses)

  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOrder, setDragOrder] = useState<string[] | null>(null)
  const lastSwapWithRef = useRef<string | null>(null)
  const rowRefs = useRef(new Map<string, BoxRenderable>())
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
      dispatchGlobal({ orderedIds: finalOrder, type: 'reorder-projects' })
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
  }, [baselineOrder, dragOrder, draggingId, ordered])

  const cancelDrag = useCallback(() => {
    setDraggingId(null)
    setDragOrder(null)
    lastSwapWithRef.current = null
  }, [])

  const handleNewProject = useCallback((e: OtuiMouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    dispatchGlobal({ returnToProjectPicker: false, type: 'open-create-project-modal' })
  }, [])

  // The settings screen's only mouse-reachable way in. It lives here because this
  // header is on screen whenever the left bar is, and because the `+` beside it
  // already taught the same gesture.
  const handleOpenSettings = useCallback((e: OtuiMouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    dispatchGlobal({ type: 'enter-settings' })
  }, [])

  const visibleProjects =
    dragOrder !== null
      ? dragOrder
          .map((id) => ordered.find((s) => s.id === id))
          .filter((s): s is ProjectRecord => !!s)
      : ordered

  const rule = RULE.repeat(Math.max(1, contentWidth))

  return (
    <box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
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
          for (const project of visibleProjects) {
            const projectIndex = baselineOrder.indexOf(project.id) + 1
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
              <ProjectRow
                key={`ws:${project.id}`}
                project={project}
                inCurrentGroup={isCurrentProject}
                projectIndex={projectIndex}
                status={statusMap[project.id] ?? IDLE_PROJECT_STATUS}
                dragging={draggingId === project.id}
                contentWidth={contentWidth}
                // Every project gets a blank line above it, which doubles as
                // the gap under the header — one rule instead of a spacer row
                // that would shift the list every time the header changes.
                marginTop={1}
                setRowRef={setRowRef}
                onDragStart={handleRowDragStart}
                onDrag={handleRowDrag}
                onDrop={commitDrop}
                onDragCancel={cancelDrag}
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
          return rows
        })()}
      </scrollbox>
      <box flexShrink={0}>
        <text fg={t.border} selectable={false} wrapMode="none">
          {rule}
        </text>
      </box>
      <box flexDirection="row" flexShrink={0} paddingLeft={1} paddingRight={1}>
        <text fg={t.textMuted} selectable={false} wrapMode="none" onMouseDown={handleOpenSettings}>
          {`${SETTINGS_GLYPH} Settings`}
        </text>
      </box>
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
  /** Vertical spacing above this row — used to separate project blocks. */
  marginTop: number
  setRowRef: (id: string, ref: BoxRenderable | null) => void
  onDragStart: (id: string) => void
  onDrag: (event: OtuiMouseEvent) => void
  onDrop: () => void
  onDragCancel: () => void
}

const ProjectRow = memo(function ProjectRow({
  contentWidth,
  dragging,
  inCurrentGroup,
  marginTop,
  onDrag,
  onDragCancel,
  onDragStart,
  onDrop,
  project,
  projectIndex,
  setRowRef,
  status,
}: ProjectRowProps) {
  const t = useTheme()
  // Selection highlight must stay opaque in transparent mode — otherwise the
  // cursor row visually disappears against the see-through chrome.
  const base = useBaseTheme()
  const showSpinner = status.working
  const showWaiting = status.waiting
  const spinner = useBusySpinner(showSpinner)
  // Only the drag highlight is "selected"-strength here. A heading that lights
  // up like a cursor row is what made the project look like a workspace.
  let bgColor: string | undefined
  if (dragging) {
    bgColor = base.backgroundElement
  } else if (inCurrentGroup) {
    bgColor = base.backgroundPanel
  }
  const workingColor = t.primary
  const waitingColor = t.warning
  const currentProjectId = useAppStore((s) => s.currentProjectId)

  const handleRef = useCallback(
    (r: BoxRenderable | null) => setRowRef(project.id, r),
    [setRowRef, project.id]
  )
  const handleMouseDown = useCallback(
    (e: OtuiMouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      onDragStart(project.id)
    },
    [onDragStart, project.id]
  )
  const handleMouseUp = useCallback(
    (e: OtuiMouseEvent) => {
      e.preventDefault()
      onDrop()
    },
    [onDrop]
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

  // Neutral muted marker; working/waiting overrides it. Keeping a glyph
  // in the slot avoids name shifts when state indicators come and go.
  let leadingGlyph = '•'
  let leadingColor = t.textMuted
  if (showWaiting) {
    leadingGlyph = '?'
    leadingColor = waitingColor
  } else if (showSpinner) {
    leadingGlyph = spinner
    leadingColor = workingColor
  }

  // No branch line: the repo checkout is not somewhere aimux works, so naming
  // it under every project only ever read as "you are on main".
  const nameLabel = truncate(project.name, Math.max(0, contentWidth - 6))

  return (
    <ContextMenuBox
      ref={handleRef}
      id={`sidebar-ws-${project.id}`}
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
        <text fg={t.text} selectable={false} wrapMode="none">
          {' '}
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

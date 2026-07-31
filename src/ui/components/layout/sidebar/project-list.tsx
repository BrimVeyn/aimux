import type {
  BoxRenderable,
  MouseEvent as OtuiMouseEvent,
  ScrollBoxRenderable,
} from '@opentui/core'

import { memo, type ReactNode, useCallback, useMemo, useRef, useState } from 'react'

import type { ProjectRecord, ProjectStatus } from '../../../../state/types'

import { useAppStore } from '../../../../state/app-store'
import { dispatchGlobal, runSideEffectGlobal } from '../../../../state/dispatch-ref'
// eslint-disable-next-line no-duplicate-imports
import { IDLE_PROJECT_STATUS } from '../../../../state/types'
import { useBusySpinner } from '../../../hooks/use-busy-spinner'
import { moveIdToIdPosition, orderProjectsForDisplay } from '../../../project-ordering'
import { useBaseTheme, useTheme } from '../../../theme'
import { FlashLabelBadge } from '../../flash/flash-label-badge'
import { ContextMenuBox } from '../../overlays/context-menu/context-menu-box'
import { useSidebarAutoScroll } from './use-sidebar-auto-scroll'
import { WorkspaceRow } from './workspace-row'

interface ProjectListProps {
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
  // The active row can be either a workspace row OR the project row
  // (when the primary workspace is active). Both must scroll into view —
  // otherwise the cursor visually "disappears" off-screen when crossing
  // a project boundary on a key press.
  const currentWorkspaces = currentProject?.workspaces ?? []
  const currentPrimary =
    currentWorkspaces.find((w) => w.source === 'primary') ?? currentWorkspaces[0]
  const rawActiveWorkspaceId = currentProject?.activeWorkspaceId
  const activeOnNonPrimary =
    rawActiveWorkspaceId != null &&
    rawActiveWorkspaceId !== '' &&
    rawActiveWorkspaceId !== currentPrimary?.id
  let activeRowId: string | null = null
  if (activeOnNonPrimary) {
    activeRowId = `sidebar-wt-${rawActiveWorkspaceId}`
  } else if (currentProjectId != null && currentProjectId !== '') {
    activeRowId = `sidebar-ws-${currentProjectId}`
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
      dispatchGlobal({ orderedIds: finalOrder, type: 'reorder-projects' })
      return
    }

    const idx = baselineOrder.indexOf(source)
    if (idx >= 0) {
      // The project row visually anchors the project's primary workspace
      // (its branch line shows the primary's branch). Clicking it should
      // land on the primary — same semantics as j/k cycling onto a project
      // item — instead of preserving whatever non-primary workspace happened
      // to be active last time we left this project.
      const sourceProject = ordered.find((s) => s.id === source)
      const sourceWorkspaces = sourceProject?.workspaces ?? []
      const sourcePrimaryId = (
        sourceWorkspaces.find((w) => w.source === 'primary') ?? sourceWorkspaces[0]
      )?.id
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

  const visibleProjects =
    dragOrder !== null
      ? dragOrder
          .map((id) => ordered.find((s) => s.id === id))
          .filter((s): s is ProjectRecord => !!s)
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
          // Build a single flat list of items — project rows interleaved
          // with their non-primary workspaces. One map, one React keypath per
          // visible row; transitions are a single atomic reconciliation.
          const rows: ReactNode[] = []
          for (const [visibleIdx, project] of visibleProjects.entries()) {
            const projectIndex = baselineOrder.indexOf(project.id) + 1
            const isCurrentProject = project.id === currentProjectId
            const workspaces = project.workspaces ?? []
            const primaryWorkspace = workspaces.find((w) => w.source === 'primary') ?? workspaces[0]
            const extraWorkspaces = workspaces.filter((w) => w.id !== primaryWorkspace?.id)
            const projectIsActiveItem =
              isCurrentProject &&
              (project.activeWorkspaceId == null ||
                project.activeWorkspaceId === '' ||
                project.activeWorkspaceId === primaryWorkspace?.id)
            rows.push(
              <ProjectRow
                key={`ws:${project.id}`}
                project={project}
                isActiveItem={projectIsActiveItem}
                inCurrentGroup={isCurrentProject}
                projectIndex={projectIndex}
                status={statusMap[project.id] ?? IDLE_PROJECT_STATUS}
                dragging={draggingId === project.id}
                contentWidth={contentWidth}
                marginTop={visibleIdx > 0 ? 1 : 0}
                setRowRef={setRowRef}
                onDragStart={handleRowDragStart}
                onDrag={handleRowDrag}
                onDrop={commitDrop}
                onDragCancel={cancelDrag}
              />
            )
            for (const workspace of extraWorkspaces) {
              rows.push(
                <WorkspaceRow
                  key={`wt:${workspace.id}`}
                  project={project}
                  workspace={workspace}
                  projectIndex={projectIndex}
                  isActiveItem={isCurrentProject && workspace.id === project.activeWorkspaceId}
                  inCurrentGroup={isCurrentProject}
                  contentWidth={contentWidth}
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
        onMouseDown={handleNewProject}
      >
        <text fg={t.text} selectable={false}>
          + New project
        </text>
      </box>
    </box>
  )
}

interface ProjectRowProps {
  project: ProjectRecord
  /** True when this row is the active cursor item (project's primary active). */
  isActiveItem: boolean
  /** True when this row belongs to the current project (selection scope). */
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
  isActiveItem,
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
  let bgColor: string | undefined
  if (dragging || isActiveItem) {
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

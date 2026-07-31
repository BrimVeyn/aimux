import type {
  BoxRenderable,
  MouseEvent as OtuiMouseEvent,
  ScrollBoxRenderable,
} from '@opentui/core'

import { memo, type ReactNode, useCallback, useMemo, useRef, useState } from 'react'

import type { ProjectRecord, ProjectStatus, WorktreeRecord } from '../../../../state/types'

import { useAppStore } from '../../../../state/app-store'
import { dispatchGlobal, runSideEffectGlobal } from '../../../../state/dispatch-ref'
import { formatDivergence } from '../../../../state/project-worktrees'
// eslint-disable-next-line no-duplicate-imports
import { IDLE_PROJECT_STATUS } from '../../../../state/types'
import { useBusySpinner } from '../../../hooks/use-busy-spinner'
import { moveIdToIdPosition, orderProjectsForDisplay } from '../../../project-ordering'
import { useBaseTheme, useTheme } from '../../../theme'
import { FlashLabelBadge } from '../../flash/flash-label-badge'
import { ContextMenuBox } from '../../overlays/context-menu/context-menu-box'
import { useSidebarAutoScroll } from './use-sidebar-auto-scroll'
import { WorktreeRow } from './worktree-row'

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
  // The active row can be either a worktree row OR the project row
  // (when the primary worktree is active). Both must scroll into view —
  // otherwise the cursor visually "disappears" off-screen when crossing
  // a project boundary on a key press.
  const currentWorktrees = currentProject?.worktrees ?? []
  const currentPrimary = currentWorktrees.find((w) => w.source === 'primary') ?? currentWorktrees[0]
  const rawActiveWorktreeId = currentProject?.activeWorktreeId
  const activeOnNonPrimary =
    rawActiveWorktreeId != null &&
    rawActiveWorktreeId !== '' &&
    rawActiveWorktreeId !== currentPrimary?.id
  let activeRowId: string | null = null
  if (activeOnNonPrimary) {
    activeRowId = `sidebar-wt-${rawActiveWorktreeId}`
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
      // The project row visually anchors the project's primary worktree
      // (its branch line shows the primary's branch). Clicking it should
      // land on the primary — same semantics as j/k cycling onto a project
      // item — instead of preserving whatever non-primary worktree happened
      // to be active last time we left this project.
      const sourceProject = ordered.find((s) => s.id === source)
      const sourceWorktrees = sourceProject?.worktrees ?? []
      const sourcePrimaryId = (
        sourceWorktrees.find((w) => w.source === 'primary') ?? sourceWorktrees[0]
      )?.id
      runSideEffectGlobal({
        index: idx + 1,
        type: 'switch-project-by-index',
        worktreeId: sourcePrimaryId,
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
          // with their non-primary worktrees. One map, one React keypath per
          // visible row; transitions are a single atomic reconciliation.
          const rows: ReactNode[] = []
          for (const [visibleIdx, project] of visibleProjects.entries()) {
            const projectIndex = baselineOrder.indexOf(project.id) + 1
            const isCurrentProject = project.id === currentProjectId
            const worktrees = project.worktrees ?? []
            const primaryWorktree = worktrees.find((w) => w.source === 'primary') ?? worktrees[0]
            const extraWorktrees = worktrees.filter((w) => w.id !== primaryWorktree?.id)
            const projectIsActiveItem =
              isCurrentProject &&
              (project.activeWorktreeId == null ||
                project.activeWorktreeId === '' ||
                project.activeWorktreeId === primaryWorktree?.id)
            rows.push(
              <ProjectRow
                key={`ws:${project.id}`}
                project={project}
                isActiveItem={projectIsActiveItem}
                inCurrentGroup={isCurrentProject}
                primaryWorktree={primaryWorktree}
                hasExtraWorktrees={extraWorktrees.length > 0}
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
            for (const [wtIdx, worktree] of extraWorktrees.entries()) {
              rows.push(
                <WorktreeRow
                  key={`wt:${worktree.id}`}
                  project={project}
                  worktree={worktree}
                  projectIndex={projectIndex}
                  isActiveItem={isCurrentProject && worktree.id === project.activeWorktreeId}
                  inCurrentGroup={isCurrentProject}
                  isLast={wtIdx === extraWorktrees.length - 1}
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
  /** The project's primary worktree — its git branch is shown as the project's anchor identity. */
  primaryWorktree: WorktreeRecord | undefined
  /** True when at least one non-primary worktree follows — used to draw the tree continuator. */
  hasExtraWorktrees: boolean
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
  hasExtraWorktrees,
  inCurrentGroup,
  isActiveItem,
  marginTop,
  onDrag,
  onDragCancel,
  onDragStart,
  onDrop,
  primaryWorktree,
  project,
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
  const divergence = useAppStore((s) =>
    primaryWorktree ? s.worktreeDivergence[primaryWorktree.id] : undefined
  )

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

  const branchText = primaryWorktree?.branch ?? ''
  const divergenceText = formatDivergence(divergence)
  const showBranch = branchText !== ''
  const nameLabel = truncate(project.name, Math.max(0, contentWidth - 4))
  const branchLabel = truncate(
    branchText,
    Math.max(0, contentWidth - 5 - (divergenceText.length + 1))
  )

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
      </box>
      {showBranch ? (
        <box flexDirection="row">
          <text fg={t.textMuted} selectable={false} wrapMode="none">
            {hasExtraWorktrees ? '│ ' : '  '}
            {'\u{e702}'} {branchLabel}
            {divergenceText !== '' ? ` ${divergenceText}` : ''}
          </text>
        </box>
      ) : null}
    </ContextMenuBox>
  )
})

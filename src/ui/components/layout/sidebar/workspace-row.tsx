import { type MouseEvent as OtuiMouseEvent, TextAttributes } from '@opentui/core'
import { memo, useCallback, useMemo } from 'react'

import type { ProjectRecord, WorkspaceActivity, WorkspaceRecord } from '../../../../state/types'
import type { SpriteState } from '../../../terminal-graphics/sprites'

import { useAppStore } from '../../../../state/app-store'
import { dispatchGlobal, runSideEffectGlobal } from '../../../../state/dispatch-ref'
// eslint-disable-next-line no-duplicate-imports
import { IDLE_WORKSPACE_ACTIVITY } from '../../../../state/types'
import { formatDiffStat } from '../../../../state/workspace-view'
import { useActivitySprite } from '../../../hooks/use-activity-sprite'
import { useBusySpinner } from '../../../hooks/use-busy-spinner'
// eslint-disable-next-line no-duplicate-imports
import { SPRITE_COLS } from '../../../terminal-graphics/sprites'
import { useBaseTheme, useTheme } from '../../../theme'
import { truncate } from '../../../truncate'
import { FlashLabelBadge } from '../../flash/flash-label-badge'
import { ContextMenuBox } from '../../overlays/context-menu/context-menu-box'

/** Same priority as the glyphs below, so a sprite says what the glyph would. */
function spriteStateFor(activity: WorkspaceActivity): SpriteState {
  if (activity.waiting) return 'waiting'
  if (activity.working) return 'working'
  if (activity.done) return 'done'
  return 'idle'
}

interface WorkspaceRowProps {
  project: ProjectRecord
  workspace: WorkspaceRecord
  /** 1-based index of the project in the visible order (for switch-project-by-index). */
  projectIndex: number
  /** True when this row is the active cursor item. */
  isActiveItem: boolean
  /** True when this row's project is the current project (selection scope). */
  inCurrentGroup: boolean
  contentWidth: number
}

export const WorkspaceRow = memo(function WorkspaceRow({
  contentWidth,
  inCurrentGroup,
  isActiveItem,
  project,
  projectIndex,
  workspace,
}: WorkspaceRowProps) {
  const t = useTheme()
  // Selection highlight must stay opaque in transparent mode.
  const base = useBaseTheme()
  const currentProjectId = useAppStore((s) => s.currentProjectId)
  const isCurrentProject = project.id === currentProjectId
  const divergence = useAppStore((s) => s.workspaceDivergence[workspace.id])
  const activity = useAppStore((s) => s.workspaceActivity[workspace.id]) ?? IDLE_WORKSPACE_ACTIVITY
  // A sprite is placed across the two lines of the row, so only a row that has
  // both — the branch line under the name — can carry one. A branchless checkout
  // keeps the text marker rather than getting a second placement geometry of its
  // own: one shape is what keeps a cell from resolving to the wrong image.
  const hasBranch = workspace.branch != null && workspace.branch !== ''
  const sprite = useActivitySprite(hasBranch ? spriteStateFor(activity) : null)
  // Only the working case animates, so the timer is off for every other row —
  // and off entirely when a sprite is drawing this row instead.
  const spinner = useBusySpinner(activity.working && sprite === null)
  // A primitive, so the selector stays referentially stable across renders.
  const hasSleepingTabs = useAppStore((s) =>
    s.tabs.some((tab) => tab.workspaceId === workspace.id && tab.hibernated === true)
  )

  const handleMouseDown = useCallback(
    (event: OtuiMouseEvent) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      if (isCurrentProject) {
        dispatchGlobal({
          projectId: project.id,
          type: 'set-active-workspace',
          workspaceId: workspace.id,
        })
        return
      }
      // Cross-project click: send the workspace id along with the switch so
      // the side effect can apply it atomically. Splitting it into a separate
      // dispatch+switch leaves a window where subscribers/re-renders can
      // re-assert the target project's last-persisted workspace.
      runSideEffectGlobal({
        index: projectIndex,
        type: 'switch-project-by-index',
        workspaceId: workspace.id,
      })
    },
    [isCurrentProject, project.id, projectIndex, workspace.id]
  )

  const rightClickMenu = useMemo<[string, () => void][] | undefined>(() => {
    const entries: [string, () => void][] = [
      [
        'Rename',
        () =>
          dispatchGlobal({
            initialName: workspace.name,
            projectId: project.id,
            type: 'open-rename-workspace-modal',
            workspaceId: workspace.id,
          }),
      ],
    ]
    entries.push([
      'Hibernate',
      () => runSideEffectGlobal({ type: 'hibernate-workspace', workspaceId: workspace.id }),
    ])
    if (workspace.source !== 'primary') {
      entries.push([
        'Remove workspace',
        () =>
          // Always confirm first. Confirming routes through the full delete side
          // effect (closes the workspace's tabs, disposes their PTYs, prunes the
          // snapshot, removes the git worktree). closeTabs (not force) cleans up
          // the tabs while keeping the non-force `git worktree remove`, so
          // uncommitted work in a temp workspace is still protected — a dirty
          // workspace re-prompts for an explicit force-delete.
          dispatchGlobal({
            closeTabs: true,
            force: false,
            projectId: project.id,
            reason: 'Its assistant tabs will be closed and the worktree removed.',
            type: 'open-workspace-delete-confirm',
            workspaceId: workspace.id,
            workspaceLabel: workspace.branch ?? workspace.name,
          }),
      ])
    }
    return entries
  }, [project.id, workspace.branch, workspace.id, workspace.name, workspace.source])

  let bgColor: string | undefined
  if (isActiveItem) {
    bgColor = base.backgroundElement
  } else if (inCurrentGroup) {
    bgColor = base.backgroundPanel
  }
  // The cursor: a full-height accent bar down the left of the row, both lines
  // of it. The background alone is one step of grey and gets lost among rows
  // that carry colour of their own; a bar the height of the row is found
  // without reading anything.
  const cursorGlyph = isActiveItem ? '▌' : ' '

  // The marker slot: two cells of text, or the wider box a sprite needs. The
  // bundled set covers every state, so with sprites on, every two-line row uses
  // the same width whatever its state — only a branchless row keeps the narrow
  // slot, and its name sits one cell left of its siblings'. Accepted: the
  // alternative is a second placement geometry, which is what mis-sized every
  // sprite in the first place.
  const markerCells = sprite === null ? 2 : SPRITE_COLS

  const { added, removed } = formatDiffStat(divergence)
  const statWidth = added.length + removed.length + (added !== '' && removed !== '' ? 1 : 0)
  const nameLabel = truncate(
    workspace.name,
    Math.max(0, contentWidth - 2 - markerCells - (statWidth > 0 ? statWidth + 1 : 0))
  )
  // Second line, hanging under the name, and where the branch glyph lives — it
  // labels the branch, not the workspace. Only workspaces that own a branch get
  // one — an external checkout without one would otherwise be a row of a
  // different height for no information.
  // The glyph starts where the name above it starts, so the branch hangs one
  // glyph-width in from it — the row reads as a title with a labelled line
  // under it, not as two columns.
  const branchLabel = !hasBranch
    ? null
    : truncate(workspace.branch ?? '', Math.max(0, contentWidth - 4 - markerCells))

  // Same vocabulary as the project heading one level up, in the same priority:
  // a question outranks work in progress, which outranks "it finished and you
  // haven't looked". A space when there is nothing to say — the row keeps its
  // width either way, so nothing shifts.
  // Every text marker is two cells, the glyph and the gap after it, so nothing
  // shifts when an agent starts or stops. The sprite is the one exception and
  // carries its own width — see markerCells above.
  let statusGlyph = '  '
  let statusColor = t.textMuted
  if (sprite) {
    statusGlyph = sprite.glyphs[0] ?? '  '
    statusColor = sprite.fg
  } else if (activity.waiting) {
    statusGlyph = '? '
    statusColor = t.warning
  } else if (activity.working) {
    statusGlyph = `${spinner} `
    statusColor = t.primary
  } else if (activity.done) {
    statusGlyph = '● '
    statusColor = t.success
  } else if (hasSleepingTabs) {
    // Last, because anything else is news and this is the absence of it. Without
    // a marker a hibernated workspace is indistinguishable from an idle one, and
    // you would not know which rows still hold a running assistant.
    statusGlyph = 'z '
    statusColor = t.textMuted
  }

  return (
    <ContextMenuBox
      id={`sidebar-wt-${workspace.id}`}
      flexDirection="column"
      flexShrink={0}
      paddingRight={1}
      backgroundColor={bgColor}
      rightClickMenu={rightClickMenu}
      onMouseDown={handleMouseDown}
    >
      <box flexDirection="row" alignItems="center">
        <text fg={t.primary} selectable={false} wrapMode="none">
          {cursorGlyph}
        </text>
        <text fg={statusColor} selectable={false} wrapMode="none">
          {statusGlyph}
        </text>
        <FlashLabelBadge rowKey={`wt:${workspace.id}`} />
        {/* Full strength only under the cursor. Every name at full strength
            reads as a wall of white; every name muted leaves the selected row
            with nothing but a shade of grey to say so. */}
        <text
          fg={isActiveItem ? t.text : t.textMuted}
          attributes={isActiveItem ? TextAttributes.BOLD : undefined}
          selectable={false}
          wrapMode="none"
        >
          {nameLabel}
        </text>
        <box flexGrow={1} flexShrink={1} />
        {added !== '' ? (
          <text fg={t.success} selectable={false} wrapMode="none">
            {added}
          </text>
        ) : null}
        {added !== '' && removed !== '' ? (
          <text fg={t.textMuted} selectable={false} wrapMode="none">
            {' '}
          </text>
        ) : null}
        {removed !== '' ? (
          <text fg={t.error} selectable={false} wrapMode="none">
            {removed}
          </text>
        ) : null}
      </box>
      {branchLabel == null ? null : (
        <box flexDirection="row" alignItems="center">
          <text fg={t.primary} selectable={false} wrapMode="none">
            {cursorGlyph}
          </text>
          {/* The marker slot again, so a sprite tall enough to want both lines
              gets its bottom half. Two cells either way, which is what the
              branch glyph has always hung off. */}
          <text fg={statusColor} selectable={false} wrapMode="none">
            {sprite?.glyphs[1] ?? '  '}
          </text>
          <text fg={t.textMuted} selectable={false} wrapMode="none">
            {'\u{e702}'} {branchLabel}
          </text>
        </box>
      )}
    </ContextMenuBox>
  )
})

import type {
  BoxRenderable,
  MouseEvent as OtuiMouseEvent,
  ScrollBoxRenderable,
} from '@opentui/core'

import { memo, type ReactNode, useCallback, useMemo, useRef, useState } from 'react'

import type { FocusMode, TabSession } from '../../../state/types'

import { useWorkspaceDivergencePolling } from '../../../git/workspace-divergence-poller'
import { useAppStore } from '../../../state/app-store'
import { getBarWidth } from '../../../state/bars'
import { dispatchGlobal, runSideEffectGlobal } from '../../../state/dispatch-ref'
import { filterTabsForActiveWorkspace } from '../../../state/project-workspaces'
import { buildTabEntries, type GroupEntry, type TabEntry } from '../../../state/tab-entries'
import { useScrollActiveIntoView } from '../../hooks/use-scroll-active-into-view'
import { moveIdToIdPosition } from '../../project-ordering'
import { useTheme, useTransparent } from '../../theme'
import { FlashLabelBadge } from '../flash/flash-label-badge'
import { ContextMenuBox } from '../overlays/context-menu/context-menu-box'
import { TabItem } from './sidebar/tab-item'

interface TopTabBarProps {
  /**
   * A full-screen view has replaced the pane tree (git mode, settings). The strip
   * shows regardless of the user's own preference — it is the only orientation
   * left — but it shows as a strip to read, not to act on.
   */
  panesReplaced?: boolean
}

const ROW_CONTENT_OPTIONS = {
  flexDirection: 'row' as const,
  gap: 0,
  justifyContent: 'flex-start' as const,
}

function getGroupIndicator(active: boolean, focused: boolean): string {
  if (!active) return '·'
  return focused ? '›' : '•'
}

function getGroupIndicatorColor(
  t: ReturnType<typeof useTheme>,
  active: boolean,
  focused: boolean
): string {
  if (!active) return t.textMuted
  return focused ? t.primary : t.text
}

const TopTabCell = memo(function TopTabCell({
  active,
  backgroundColor,
  children,
  entryId,
  onDrag,
  onDragCancel,
  onDragStart,
  onDrop,
  setCellRef,
}: {
  entryId: string
  active: boolean
  backgroundColor: string | undefined
  setCellRef: (entryId: string, ref: BoxRenderable | null) => void
  onDragStart: (entryId: string) => void
  onDrag: (event: OtuiMouseEvent) => void
  onDrop: () => void
  onDragCancel: () => void
  children: ReactNode
}) {
  const handleRef = useCallback(
    (r: BoxRenderable | null) => setCellRef(entryId, r),
    [setCellRef, entryId]
  )
  const handleMouseDown = useCallback(
    (event: OtuiMouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      onDragStart(entryId)
    },
    [onDragStart, entryId]
  )
  const handleMouseUp = useCallback(
    (event: OtuiMouseEvent) => {
      event.preventDefault()
      onDrop()
    },
    [onDrop]
  )
  return (
    <box
      ref={handleRef}
      backgroundColor={backgroundColor}
      flexDirection="row"
      flexShrink={0}
      onMouseDown={handleMouseDown}
      onMouseDrag={onDrag}
      onMouseUp={handleMouseUp}
      onMouseDragEnd={onDragCancel}
      data-active={active ? 'true' : undefined}
    >
      {children}
    </box>
  )
})

function GroupTabItem({
  active,
  entry,
  focused,
  indexLabel,
}: {
  entry: GroupEntry
  active: boolean
  focused: boolean
  indexLabel?: string
}) {
  const t = useTheme()
  const indicator = getGroupIndicator(active, focused)
  const indicatorColor = getGroupIndicatorColor(t, active, focused)

  const closeGroup = useCallback(() => {
    for (const tab of entry.tabs) {
      dispatchGlobal({ tabId: tab.id, type: 'close-tab' })
      runSideEffectGlobal({ tabId: tab.id, type: 'close-tab' })
    }
  }, [entry.tabs])

  const handleCloseMouseDown = useCallback(
    (event: OtuiMouseEvent) => {
      event.stopPropagation()
      closeGroup()
    },
    [closeGroup]
  )

  const rightClickMenu = useMemo<[string, () => void][]>(
    () => [['Close group', closeGroup]],
    [closeGroup]
  )

  return (
    <ContextMenuBox
      id={`top-tab-${entry.id}`}
      paddingLeft={1}
      paddingRight={1}
      flexDirection="row"
      alignItems="center"
      rightClickMenu={rightClickMenu}
    >
      <text fg={indicatorColor} selectable={false}>
        {indicator}{' '}
      </text>
      {indexLabel != null && indexLabel !== '' ? (
        <text fg={t.textMuted} selectable={false} wrapMode="none">
          {indexLabel}{' '}
        </text>
      ) : null}
      {entry.tabs.map((tab, i) => {
        const isLeafActive = tab.id === entry.activeLeafId
        return (
          <box key={tab.id} flexDirection="row" flexShrink={0}>
            {i > 0 ? (
              <text fg={t.textMuted} selectable={false} wrapMode="none">
                {' | '}
              </text>
            ) : null}
            <FlashLabelBadge rowKey={`tab:${tab.id}`} />
            <text fg={isLeafActive ? t.text : t.textMuted} selectable={false} wrapMode="none">
              {tab.title}
            </text>
          </box>
        )
      })}
      <box paddingLeft={1} onMouseDown={handleCloseMouseDown}>
        <text fg={t.textMuted} selectable={false}>
          ×
        </text>
      </box>
    </ContextMenuBox>
  )
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/** Flatten an entry into the underlying tab ids, in display order. */
function entryTabIds(entry: TabEntry): string[] {
  return entry.kind === 'single' ? [entry.tab.id] : entry.tabs.map((tab) => tab.id)
}

export function TopTabBar({ panesReplaced = false }: TopTabBarProps) {
  const t = useTheme()
  // Transparent mode paints the tabs, not the strip they sit in: past the last
  // tab the bar is empty space, and a band of chrome around nothing is exactly
  // what transparency is for getting rid of. Each cell carries the surface
  // instead, so a tab still reads as a tab and the tail is a void.
  const transparent = useTransparent()
  const headerBg = transparent ? undefined : t.backgroundPanel
  const idleTabBg = transparent ? t.backgroundPanel : undefined
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const bar = useAppStore((s) => s.projectBar)
  const leftBarVisible = useAppStore((s) => getBarWidth(s.bars.left) > 0)
  const currentProjectId = useAppStore((s) => s.currentProjectId)
  const projects = useAppStore((s) => s.projects)
  const focusMode: FocusMode = useAppStore((s) => s.focusMode)
  const layoutTrees = useAppStore((s) => s.layoutTrees)
  const tabGroupMap = useAppStore((s) => s.tabGroupMap)

  // Sidebar now also shows workspace chips with divergence — poll whenever
  // either surface is visible.
  useWorkspaceDivergencePolling(bar.visible || leftBarVisible || panesReplaced)

  const currentProject = useMemo(
    () =>
      currentProjectId != null && currentProjectId !== ''
        ? projects.find((s) => s.id === currentProjectId)
        : undefined,
    [currentProjectId, projects]
  )

  const visibleTabs = useMemo(
    () => filterTabsForActiveWorkspace(tabs, currentProject),
    [tabs, currentProject]
  )

  const entries = useMemo(
    () => buildTabEntries(visibleTabs, layoutTrees, tabGroupMap, activeTabId),
    [visibleTabs, layoutTrees, tabGroupMap, activeTabId]
  )

  const activeEntryId = useMemo(() => {
    for (const entry of entries) {
      if (entry.kind === 'single') {
        if (entry.tab.id === activeTabId) return entry.id
      } else if (entry.tabs.some((tab) => tab.id === activeTabId)) {
        return entry.id
      }
    }
    return null
  }, [entries, activeTabId])

  const scrollRef = useRef<ScrollBoxRenderable | null>(null)
  useScrollActiveIntoView({
    activeId: activeEntryId,
    idPrefix: 'top-tab-',
    scrollRef,
    visible: bar.visible || panesReplaced,
  })

  const handleEntryActivate = useCallback(
    (entryId: string) => {
      const entry = entries.find((e) => e.id === entryId)
      if (!entry) return
      const targetTabId = entry.kind === 'single' ? entry.tab.id : entry.activeLeafId
      if (targetTabId !== activeTabId) {
        dispatchGlobal({ tabId: targetTabId, type: 'set-active-tab' })
      }
      dispatchGlobal({ focusMode: 'terminal-input', type: 'set-focus-mode' })
    },
    [entries, activeTabId]
  )

  // --- Drag-and-drop reorder of the tab strip ---------------------------------
  // Mirrors the project-list drag, but on the horizontal axis: entries are
  // laid out left-to-right inside a scrollX box, so hit-testing is on x/width.
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOrder, setDragOrder] = useState<string[] | null>(null)
  const lastSwapWithRef = useRef<string | null>(null)
  const cellRefs = useRef(new Map<string, BoxRenderable>())

  const baselineOrder = useMemo(() => entries.map((e) => e.id), [entries])

  const setCellRef = useCallback((id: string, ref: BoxRenderable | null): void => {
    if (ref) cellRefs.current.set(id, ref)
    else cellRefs.current.delete(id)
  }, [])

  const findEntryAtX = useCallback((x: number): string | null => {
    for (const [id, ref] of cellRefs.current) {
      if (x >= ref.x && x < ref.x + ref.width) return id
    }
    return null
  }, [])

  const handleDragStart = useCallback(
    (id: string) => {
      setDraggingId(id)
      setDragOrder(baselineOrder)
      lastSwapWithRef.current = null
    },
    [baselineOrder]
  )

  const handleDrag = useCallback(
    (event: OtuiMouseEvent) => {
      if (!(draggingId != null && draggingId !== '')) return
      const hit = findEntryAtX(event.x)
      if (hit === null || hit === draggingId) {
        lastSwapWithRef.current = null
        return
      }
      if (hit === lastSwapWithRef.current) return
      setDragOrder((prev) => (prev ? moveIdToIdPosition(prev, draggingId, hit) : prev))
      lastSwapWithRef.current = hit
    },
    [draggingId, findEntryAtX]
  )

  const commitDrop = useCallback(() => {
    const source = draggingId
    const finalOrder = dragOrder
    setDraggingId(null)
    setDragOrder(null)
    lastSwapWithRef.current = null

    if (source == null || source === '' || !finalOrder) return

    if (!arraysEqual(finalOrder, baselineOrder)) {
      // Expand entries (groups collapse multiple tabs) back into a flat tab-id
      // order, then let the reducer rewrite only the visible tabs' slots.
      const byId = new Map(entries.map((e) => [e.id, e]))
      const orderedTabIds = finalOrder.flatMap((id) => {
        const entry = byId.get(id)
        return entry ? entryTabIds(entry) : []
      })
      dispatchGlobal({ orderedTabIds, type: 'reorder-tabs' })
      return
    }

    // No reorder happened → treat as a plain click on the entry.
    handleEntryActivate(source)
  }, [baselineOrder, dragOrder, draggingId, entries, handleEntryActivate])

  const cancelDrag = useCallback(() => {
    setDraggingId(null)
    setDragOrder(null)
    lastSwapWithRef.current = null
  }, [])

  const visibleEntries = useMemo(() => {
    if (dragOrder === null) return entries
    const byId = new Map(entries.map((e) => [e.id, e]))
    return dragOrder.map((id) => byId.get(id)).filter((e): e is TabEntry => e != null)
  }, [dragOrder, entries])

  const handleNewTab = useCallback((e: OtuiMouseEvent) => {
    e.stopPropagation()
    runSideEffectGlobal({ type: 'open-new-tab' })
  }, [])

  if (!bar.visible && !panesReplaced) return null
  // Keep the bar visible even with zero entries — when the active workspace
  // has no tabs, the lone "+" affordance is what tells the user "you're in
  // an empty workspace, click here to start one".

  const isFocused = focusMode === 'terminal-input' || focusMode === 'navigation'

  return (
    <box
      width="100%"
      height={1}
      flexDirection="row"
      flexShrink={0}
      backgroundColor={headerBg}
      overflow="hidden"
    >
      <scrollbox
        ref={scrollRef}
        height={1}
        flexGrow={1}
        flexShrink={1}
        flexBasis={0}
        scrollX
        viewportCulling
        contentOptions={ROW_CONTENT_OPTIONS}
      >
        {visibleEntries.map((entry, index) => {
          // [N] is shown only for the first 9 entries — that's the range
          // Leader+1..9 can address.
          const indexLabel = index < 9 ? `[${index + 1}]` : undefined
          const dragging = entry.id === draggingId
          if (entry.kind === 'single') {
            const tab: TabSession = entry.tab
            const isActive = tab.id === activeTabId
            return (
              <TopTabCell
                key={entry.id}
                entryId={entry.id}
                active={isActive}
                setCellRef={setCellRef}
                onDragStart={handleDragStart}
                onDrag={handleDrag}
                onDrop={commitDrop}
                onDragCancel={cancelDrag}
                backgroundColor={isActive || dragging ? t.backgroundElement : idleTabBg}
              >
                <TabItem
                  id={`top-tab-${tab.id}`}
                  tab={tab}
                  active={isActive}
                  focused={isFocused}
                  indexLabel={indexLabel}
                  alwaysShowClose
                />
              </TopTabCell>
            )
          }
          const isActive = entry.tabs.some((tab) => tab.id === activeTabId)
          return (
            <TopTabCell
              key={entry.id}
              entryId={entry.id}
              active={isActive}
              setCellRef={setCellRef}
              onDragStart={handleDragStart}
              onDrag={handleDrag}
              onDrop={commitDrop}
              onDragCancel={cancelDrag}
              backgroundColor={isActive || dragging ? t.backgroundElement : idleTabBg}
            >
              <GroupTabItem
                entry={entry}
                active={isActive}
                focused={isFocused}
                indexLabel={indexLabel}
              />
            </TopTabCell>
          )
        })}
        {/* Not while a full-screen view is up: a `+` that quietly starts a tab
            and drops you out of the screen you were reading is noise, and on the
            settings screen it is not even about anything on it. */}
        {panesReplaced ? null : (
          <box
            flexDirection="row"
            flexShrink={0}
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={idleTabBg}
            onMouseDown={handleNewTab}
          >
            <text fg={t.textMuted} selectable={false}>
              +
            </text>
          </box>
        )}
      </scrollbox>
    </box>
  )
}

import type { MouseEvent as OtuiMouseEvent, ScrollBoxRenderable } from '@opentui/core'

import { memo, type ReactNode, useCallback, useMemo, useRef } from 'react'

import type { FocusMode, TabSession } from '../../../state/types'

import { useWorktreeDivergencePolling } from '../../../git/worktree-divergence-poller'
import { useAppStore } from '../../../state/app-store'
import { dispatchGlobal, runSideEffectGlobal } from '../../../state/dispatch-ref'
import { filterTabsForActiveWorktree } from '../../../state/session-worktrees'
import { buildTabEntries, type GroupEntry } from '../../../state/tab-entries'
import { useTheme } from '../../theme'
import { ContextMenuBox } from '../overlays/context-menu/context-menu-box'
import { TabItem } from './sidebar/tab-item'
import { useTopTabBarAutoScroll } from './sidebar/use-top-tab-bar-auto-scroll'

interface TopTabBarProps {
  forceVisible?: boolean
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
  onActivate,
}: {
  entryId: string
  active: boolean
  backgroundColor: string | undefined
  onActivate?: (entryId: string) => void
  children: ReactNode
}) {
  const handleMouseDown = useCallback(
    (event: OtuiMouseEvent) => {
      event.stopPropagation()
      onActivate?.(entryId)
    },
    [onActivate, entryId]
  )
  return (
    <box
      backgroundColor={backgroundColor}
      flexDirection="row"
      flexShrink={0}
      onMouseDown={handleMouseDown}
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

export function TopTabBar({ forceVisible = false }: TopTabBarProps) {
  const t = useTheme()
  const headerBg = t.backgroundPanel
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const bar = useAppStore((s) => s.sessionBar)
  const sidebar = useAppStore((s) => s.sidebar)
  const currentSessionId = useAppStore((s) => s.currentSessionId)
  const sessions = useAppStore((s) => s.sessions)
  const focusMode: FocusMode = useAppStore((s) => s.focusMode)
  const layoutTrees = useAppStore((s) => s.layoutTrees)
  const tabGroupMap = useAppStore((s) => s.tabGroupMap)

  // Sidebar now also shows worktree chips with divergence — poll whenever
  // either surface is visible.
  useWorktreeDivergencePolling(bar.visible || sidebar.visible || forceVisible)

  const currentSession = useMemo(
    () =>
      currentSessionId != null && currentSessionId !== ''
        ? sessions.find((s) => s.id === currentSessionId)
        : undefined,
    [currentSessionId, sessions]
  )

  const visibleTabs = useMemo(
    () => filterTabsForActiveWorktree(tabs, currentSession),
    [tabs, currentSession]
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
  useTopTabBarAutoScroll({
    activeTabId: activeEntryId,
    idPrefix: 'top-tab-',
    scrollRef,
    visible: bar.visible || forceVisible,
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

  const handleNewTab = useCallback((e: OtuiMouseEvent) => {
    e.stopPropagation()
    dispatchGlobal({ type: 'open-new-tab-modal' })
  }, [])

  if (!bar.visible && !forceVisible) return null
  // Keep the bar visible even with zero entries — when the active worktree
  // has no tabs, the lone "+" affordance is what tells the user "you're in
  // an empty worktree, click here to start one".

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
        {entries.map((entry, index) => {
          // [N] is shown only for the first 9 entries — that's the range
          // Leader+1..9 can address.
          const indexLabel = index < 9 ? `[${index + 1}]` : undefined
          if (entry.kind === 'single') {
            const tab: TabSession = entry.tab
            const isActive = tab.id === activeTabId
            return (
              <TopTabCell
                key={entry.id}
                entryId={entry.id}
                active={isActive}
                onActivate={handleEntryActivate}
                backgroundColor={isActive ? t.backgroundElement : undefined}
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
              onActivate={handleEntryActivate}
              backgroundColor={isActive ? t.backgroundElement : undefined}
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
        <box
          flexDirection="row"
          flexShrink={0}
          paddingLeft={1}
          paddingRight={1}
          onMouseDown={handleNewTab}
        >
          <text fg={t.textMuted} selectable={false}>
            +
          </text>
        </box>
      </scrollbox>
    </box>
  )
}

import type { MouseEvent as OtuiMouseEvent, ScrollBoxRenderable } from '@opentui/core'

import { Fragment, memo, type ReactNode, useCallback, useMemo, useRef } from 'react'

import { useWorktreeDivergencePolling } from '../../../git/worktree-divergence-poller'
import { useAppStore } from '../../../state/app-store'
import { dispatchGlobal } from '../../../state/dispatch-ref'
import { filterTabsForActiveWorktree } from '../../../state/session-worktrees'
import { useTheme } from '../../theme'
import { buildTabGroupInfo } from './sidebar/sidebar-group-metadata'
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

const GroupBracket = memo(function GroupBracket({
  color,
  side,
}: {
  color: string
  side: 'open' | 'close'
}) {
  return (
    <box flexDirection="row" flexShrink={0}>
      <text fg={color} selectable={false}>
        {side === 'open' ? '⌊' : '⌋'}
      </text>
    </box>
  )
})

const TopTabCell = memo(function TopTabCell({
  active,
  backgroundColor,
  children,
  onActivate,
  tabId,
}: {
  tabId: string
  active: boolean
  backgroundColor: string | undefined
  onActivate?: (tabId: string) => void
  children: ReactNode
}) {
  const handleMouseDown = useCallback(
    (event: OtuiMouseEvent) => {
      event.stopPropagation()
      onActivate?.(tabId)
    },
    [onActivate, tabId]
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

export function TopTabBar({ forceVisible = false }: TopTabBarProps) {
  const t = useTheme()
  const headerBg = t.backgroundPanel
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const bar = useAppStore((s) => s.sessionBar)
  const sidebar = useAppStore((s) => s.sidebar)
  const currentSessionId = useAppStore((s) => s.currentSessionId)
  const sessions = useAppStore((s) => s.sessions)
  const focusMode = useAppStore((s) => s.focusMode)
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

  const tabGroupInfo = useMemo(
    () => buildTabGroupInfo(layoutTrees, visibleTabs),
    [layoutTrees, visibleTabs]
  )

  const scrollRef = useRef<ScrollBoxRenderable | null>(null)
  useTopTabBarAutoScroll({
    activeTabId,
    idPrefix: 'top-tab-',
    scrollRef,
    visible: bar.visible || forceVisible,
  })

  const handleTabActivate = useCallback((tabId: string) => {
    dispatchGlobal({ tabId, type: 'set-active-tab' })
    dispatchGlobal({ focusMode: 'terminal-input', type: 'set-focus-mode' })
  }, [])

  const handleNewTab = useCallback((e: OtuiMouseEvent) => {
    e.stopPropagation()
    dispatchGlobal({ type: 'open-new-tab-modal' })
  }, [])

  if (!bar.visible && !forceVisible) return null
  if (visibleTabs.length === 0) return null

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
        {visibleTabs.map((tab, index) => {
          const isActive = tab.id === activeTabId
          const info = tabGroupInfo.get(tab.id)
          const inLayout = !!(info?.inLayout === true)
          // [N] is shown only for the first 9 visible tabs — that's the range
          // Leader+1..9 can address.
          const indexLabel = index < 9 ? `[${index + 1}]` : undefined
          const currentGroup = inLayout ? (tabGroupMap[tab.id] ?? null) : null
          const prevTab = index > 0 ? visibleTabs[index - 1] : undefined
          const prevInLayout = prevTab ? tabGroupInfo.get(prevTab.id)?.inLayout === true : false
          const prevGroup = prevTab && prevInLayout ? (tabGroupMap[prevTab.id] ?? null) : null
          const nextTab = visibleTabs[index + 1]
          const nextInLayout = nextTab ? tabGroupInfo.get(nextTab.id)?.inLayout === true : false
          const nextGroup = nextTab && nextInLayout ? (tabGroupMap[nextTab.id] ?? null) : null
          const isGroupStart = currentGroup !== null && currentGroup !== prevGroup
          const isGroupEnd = currentGroup !== null && currentGroup !== nextGroup
          return (
            <Fragment key={tab.id}>
              {isGroupStart ? <GroupBracket color={t.primary} side="open" /> : null}
              <TopTabCell
                tabId={tab.id}
                active={isActive}
                onActivate={handleTabActivate}
                backgroundColor={isActive ? t.backgroundElement : undefined}
              >
                <TabItem
                  id={`top-tab-${tab.id}`}
                  tab={tab}
                  active={isActive}
                  focused={focusMode === 'terminal-input' || focusMode === 'navigation'}
                  inLayout={inLayout}
                  indexLabel={indexLabel}
                  alwaysShowClose
                />
              </TopTabCell>
              {isGroupEnd ? <GroupBracket color={t.primary} side="close" /> : null}
            </Fragment>
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

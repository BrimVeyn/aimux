import type { MouseEvent as OtuiMouseEvent, ScrollBoxRenderable } from '@opentui/core'

import { memo, type ReactNode, useCallback, useMemo, useRef } from 'react'

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
        {visibleTabs.map((tab) => {
          const isActive = tab.id === activeTabId
          const info = tabGroupInfo.get(tab.id)
          const inLayout = !!(info?.inLayout === true)
          return (
            <TopTabCell
              key={tab.id}
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
              />
            </TopTabCell>
          )
        })}
      </scrollbox>
      <box
        flexDirection="row"
        flexShrink={0}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={t.backgroundElement}
        onMouseDown={handleNewTab}
      >
        <text fg={t.text} selectable={false}>
          + New
        </text>
      </box>
    </box>
  )
}

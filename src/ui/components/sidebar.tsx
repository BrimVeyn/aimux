import type { ScrollBoxRenderable } from '@opentui/core'

import { memo, useMemo, useRef } from 'react'

import { useAppStore } from '../../state/app-store'
import { getCurrentTheme, useBg, useTheme } from '../theme'
import { GitPaneWidget } from './git-pane-widget'
import { buildTabGroupInfo } from './sidebar-group-metadata'
import { TabItem } from './tab-item'
import { useSidebarAutoScroll } from './use-sidebar-auto-scroll'
import { useSidebarBranch } from './use-sidebar-branch'

interface SidebarProps {
  onTabActivate?: (tabId: string) => void
}

const GUTTER_START = '╭'
const GUTTER_MIDDLE = '├'
const GUTTER_END = '╰'
const GUTTER_PAD = '│'

const SidebarTop = memo(function SidebarTop() {
  const theme = useTheme()
  const sidebarWidth = useAppStore((s) => s.sidebar.width)
  const currentSessionId = useAppStore((s) => s.currentSessionId)
  const sessions = useAppStore((s) => s.sessions)
  const currentSession = currentSessionId
    ? sessions.find((s) => s.id === currentSessionId)
    : undefined
  const projectPath = currentSession?.projectPath
  const branch = useSidebarBranch(projectPath)

  return (
    <box flexDirection="column" flexShrink={0} gap={0}>
      <text fg={theme.colors['textLink.foreground']}>
        <strong>aimux</strong>
      </text>
      <text fg={theme.colors['terminal.ansiMagenta']}>
        {currentSession ? currentSession.name : 'No session selected'}
      </text>
      {branch ? (
        <box flexDirection="row">
          <text fg={theme.colors['textLink.foreground']}>{'\u{e702}'} </text>
          <text fg={theme.colors['descriptionForeground']}>{branch}</text>
        </box>
      ) : null}
      <text fg={theme.colors['editor.lineHighlightBackground']}>
        {'·'.repeat(Math.max(0, sidebarWidth - 2))}
      </text>
    </box>
  )
})

function renderGroupGutter(
  isGroupStart: boolean,
  isGroupMiddle: boolean,
  isGroupEnd: boolean,
  isActive: boolean
) {
  return (
    <box flexDirection="column" width={1} overflow="hidden">
      <text
        fg={getCurrentTheme().colors['terminal.ansiMagenta']}
        bg={isActive ? getCurrentTheme().colors['list.activeSelectionBackground'] : undefined}
      >
        {/* oxlint-disable-next-line no-nested-ternary */}
        {isGroupStart ? GUTTER_START : isGroupMiddle ? GUTTER_MIDDLE : GUTTER_PAD}
      </text>
      <text
        fg={getCurrentTheme().colors['terminal.ansiMagenta']}
        bg={isActive ? getCurrentTheme().colors['list.activeSelectionBackground'] : undefined}
      >
        {isGroupEnd ? GUTTER_END : GUTTER_PAD}
      </text>
    </box>
  )
}

interface TabsBodyProps {
  onTabActivate?: (tabId: string) => void
}

const TabsBody = memo(function TabsBody({ onTabActivate }: TabsBodyProps) {
  const theme = useTheme()
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const focusMode = useAppStore((s) => s.focusMode)
  const layoutTrees = useAppStore((s) => s.layoutTrees)
  const sidebarVisible = useAppStore((s) => s.sidebar.visible)

  const scrollRef = useRef<ScrollBoxRenderable | null>(null)
  const activeIndex = tabs.findIndex((tab) => tab.id === activeTabId)
  const tabGroupInfo = useMemo(() => buildTabGroupInfo(layoutTrees, tabs), [layoutTrees, tabs])

  useSidebarAutoScroll({
    activeIndex,
    activeTabId,
    scrollRef,
    tabCount: tabs.length,
    visible: sidebarVisible,
  })

  return (
    <scrollbox
      paddingTop={0}
      ref={scrollRef}
      flexGrow={1}
      scrollY
      viewportCulling
      contentOptions={{ flexDirection: 'column', gap: 0 }}
    >
      {tabs.length === 0 ? (
        <box paddingTop={1}>
          <text fg={theme.colors['descriptionForeground']}>No tabs yet. Press Ctrl+n.</text>
        </box>
      ) : (
        tabs.map((tab, index) => {
          const isActive = tab.id === activeTabId
          const info = tabGroupInfo.get(tab.id)
          const inLayout = !!info?.inLayout
          const inGroup = info ? index >= info.groupStart && index <= info.groupEnd : false
          const isGroupStart = info ? index === info.groupStart : false
          const isGroupEnd = info ? index === info.groupEnd : false
          const isGroupMiddle = inGroup && !isGroupStart && !isGroupEnd

          return (
            <box
              key={tab.id}
              flexDirection="row"
              onMouseDown={onTabActivate ? () => onTabActivate(tab.id) : undefined}
            >
              {inGroup
                ? renderGroupGutter(isGroupStart, isGroupMiddle, isGroupEnd, isActive)
                : null}
              <box flexGrow={1}>
                <TabItem
                  id={`sidebar-tab-${tab.id}`}
                  tab={tab}
                  active={isActive}
                  focused={focusMode === 'navigation'}
                  inLayout={inLayout}
                />
              </box>
            </box>
          )
        })
      )}
    </scrollbox>
  )
})

export function Sidebar({ onTabActivate }: SidebarProps) {
  const theme = useTheme()
  const sidebarBg = useBg('sideBar.background')
  const sidebarVisible = useAppStore((s) => s.sidebar.visible)
  const sidebarWidth = useAppStore((s) => s.sidebar.width)
  const gitPane = useAppStore((s) => s.gitPane)

  if (!sidebarVisible) {
    return null
  }

  const gitEmbedded = gitPane.mode === 'embedded' && gitPane.visible
  const gitOnTop = gitEmbedded && gitPane.position === 'top'
  const gitOnBottom = gitEmbedded && gitPane.position === 'bottom'

  // flex-grow scaled by 100 (integer preferred); tabs gets (1-ratio), git gets ratio.
  const tabsGrow = gitEmbedded ? Math.max(1, Math.round((1 - gitPane.ratio) * 100)) : 1
  const gitGrow = gitEmbedded ? Math.max(1, Math.round(gitPane.ratio * 100)) : 0

  const separator = (
    <text fg={theme.colors['editor.lineHighlightBackground']}>
      {'·'.repeat(Math.max(0, sidebarWidth - 2))}
    </text>
  )
  const gitBody = gitEmbedded ? (
    <box flexDirection="column" flexGrow={gitGrow} flexShrink={1} flexBasis={0} overflow="hidden">
      <GitPaneWidget pollingEnabled={gitPane.visible} />
    </box>
  ) : null

  return (
    <box
      width={sidebarWidth}
      padding={0}
      flexDirection="column"
      backgroundColor={sidebarBg}
      gap={0}
    >
      <SidebarTop />
      {gitOnTop ? (
        <>
          {gitBody}
          {separator}
        </>
      ) : null}
      <box
        flexDirection="column"
        flexGrow={tabsGrow}
        flexShrink={1}
        flexBasis={0}
        overflow="hidden"
      >
        <TabsBody onTabActivate={onTabActivate} />
      </box>
      {gitOnBottom ? (
        <>
          {separator}
          {gitBody}
        </>
      ) : null}
    </box>
  )
}

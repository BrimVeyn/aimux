import type { ScrollBoxRenderable } from '@opentui/core'

import { useEffect, useRef, useState } from 'react'

import { useAppStore } from '../../state/app-store'
import { allLeafIds } from '../../state/layout-tree'
import { getCurrentBranch } from '../git-branch'
import { theme } from '../theme'
import { getSidebarScrollTarget } from './sidebar-scroll'
import { TabItem } from './tab-item'

interface SidebarProps {
  onTabActivate?: (tabId: string) => void
}

const GUTTER_START = '╭'
const GUTTER_MIDDLE = '├'
const GUTTER_END = '╰'
const GUTTER_PAD = '│'

export function Sidebar({ onTabActivate }: SidebarProps) {
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const sidebar = useAppStore((s) => s.sidebar)
  const focusMode = useAppStore((s) => s.focusMode)
  const currentSessionId = useAppStore((s) => s.currentSessionId)
  const sessions = useAppStore((s) => s.sessions)
  const layoutTree = useAppStore((s) => s.layoutTree)

  const scrollRef = useRef<ScrollBoxRenderable | null>(null)
  const previousActiveIndexRef = useRef(-1)
  const previousVisibilityRef = useRef(sidebar.visible)
  const activeIndex = tabs.findIndex((tab) => tab.id === activeTabId)
  const [branch, setBranch] = useState<string | null>(null)

  const currentSession = currentSessionId
    ? sessions.find((s) => s.id === currentSessionId)
    : undefined
  const projectPath = currentSession?.projectPath

  useEffect(() => {
    if (!projectPath) {
      setBranch(null)
      return
    }
    getCurrentBranch(projectPath).then(setBranch)
    const interval = setInterval(() => {
      getCurrentBranch(projectPath).then(setBranch)
    }, 5_000)
    return () => clearInterval(interval)
  }, [projectPath])

  useEffect(() => {
    if (!sidebar.visible) {
      previousVisibilityRef.current = false
      previousActiveIndexRef.current = activeIndex
      return
    }

    const scrollbox = scrollRef.current
    if (!scrollbox) {
      previousVisibilityRef.current = sidebar.visible
      previousActiveIndexRef.current = activeIndex
      return
    }

    if (!previousVisibilityRef.current && activeTabId) {
      scrollbox.scrollChildIntoView(`sidebar-tab-${activeTabId}`)
      previousVisibilityRef.current = true
      previousActiveIndexRef.current = activeIndex
      return
    }

    const scrollTarget = getSidebarScrollTarget({
      previousActiveIndex: previousActiveIndexRef.current,
      nextActiveIndex: activeIndex,
      tabCount: tabs.length,
    })

    if (scrollTarget === 'top') {
      scrollbox.scrollTo({ x: 0, y: 0 })
    } else if (scrollTarget === 'bottom') {
      scrollbox.scrollTo({ x: 0, y: scrollbox.scrollHeight })
    } else if (scrollTarget === 'active-item' && activeTabId) {
      scrollbox.scrollChildIntoView(`sidebar-tab-${activeTabId}`)
    }

    previousVisibilityRef.current = sidebar.visible
    previousActiveIndexRef.current = activeIndex
  }, [activeIndex, activeTabId, sidebar.visible, tabs.length])

  if (!sidebar.visible) {
    return null
  }

  return (
    <box
      width={sidebar.width}
      border
      borderColor={focusMode === 'navigation' ? theme.borderActive : theme.border}
      padding={0}
      flexDirection="column"
      backgroundColor={theme.panelMuted}
      gap={0}
    >
      <text fg={theme.accent}>
        <strong>aimux</strong>
      </text>
      <text fg={theme.accentAlt}>
        {currentSession ? currentSession.name : 'No session selected'}
      </text>
      {branch ? (
        <box flexDirection="row">
          <text fg={theme.accent}>{'\u{e702}'} </text>
          <text fg={theme.textMuted}>{branch}</text>
        </box>
      ) : null}
      <text fg={theme.dim}>{'─'.repeat(Math.max(0, sidebar.width - 2))}</text>
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
            <text fg={theme.textMuted}>No tabs yet. Press Ctrl+n.</text>
          </box>
        ) : (
          (() => {
            const layoutIds = layoutTree ? allLeafIds(layoutTree) : []
            const layoutSet = layoutIds.length > 1 ? new Set(layoutIds) : new Set<string>()
            const hasGroup = layoutSet.size > 0

            let groupStart = -1
            let groupEnd = -1
            if (hasGroup) {
              groupStart = tabs.findIndex((t) => layoutSet.has(t.id))
              for (let i = tabs.length - 1; i >= 0; i--) {
                if (layoutSet.has(tabs[i]!.id)) {
                  groupEnd = i
                  break
                }
              }
            }

            return tabs.map((tab, index) => {
              const isActive = tab.id === activeTabId
              const inLayout = layoutSet.has(tab.id)
              const inGroup = hasGroup && index >= groupStart && index <= groupEnd
              const isGroupStart = index === groupStart
              const isGroupEnd = index === groupEnd
              const isGroupMiddle = !isGroupStart && !isGroupEnd

              return (
                <box
                  key={tab.id}
                  flexDirection="row"
                  onMouseDown={onTabActivate ? () => onTabActivate(tab.id) : undefined}
                >
                  {inGroup ? (
                    <box flexDirection="column" width={1} overflow="hidden">
                      <text fg={theme.accent}>{isGroupStart ? GUTTER_START : GUTTER_PAD}</text>
                      <text fg={theme.accent}>{GUTTER_PAD}</text>
                      <text fg={theme.accent}>{isGroupMiddle ? GUTTER_MIDDLE : GUTTER_PAD}</text>
                      <text fg={theme.accent}>{isGroupEnd ? GUTTER_END : GUTTER_PAD}</text>
                    </box>
                  ) : null}
                  <box flexGrow={1}>
                    <TabItem
                      id={`sidebar-tab-${tab.id}`}
                      tab={tab}
                      active={isActive}
                      focused={focusMode === 'navigation'}
                      isFocusedInput={isActive && focusMode === 'terminal-input'}
                      inLayout={inLayout}
                    />
                  </box>
                </box>
              )
            })
          })()
        )}
      </scrollbox>
    </box>
  )
}

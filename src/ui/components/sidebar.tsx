import type { ScrollBoxRenderable } from '@opentui/core'

import { useEffect, useRef, useState } from 'react'

import type { AppState } from '../../state/types'

import { allLeafIds } from '../../state/layout-tree'
import { getCurrentBranch } from '../git-branch'
import { theme } from '../theme'
import { getSidebarScrollTarget } from './sidebar-scroll'
import { TabItem } from './tab-item'

interface SidebarProps {
  state: AppState
  onTabActivate?: (tabId: string) => void
}

export function Sidebar({ state, onTabActivate }: SidebarProps) {
  const scrollRef = useRef<ScrollBoxRenderable | null>(null)
  const previousActiveIndexRef = useRef(-1)
  const previousVisibilityRef = useRef(state.sidebar.visible)
  const activeIndex = state.tabs.findIndex((tab) => tab.id === state.activeTabId)
  const [branch, setBranch] = useState<string | null>(null)

  const currentSession = state.currentSessionId
    ? state.sessions.find((s) => s.id === state.currentSessionId)
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
    if (!state.sidebar.visible) {
      previousVisibilityRef.current = false
      previousActiveIndexRef.current = activeIndex
      return
    }

    const scrollbox = scrollRef.current
    if (!scrollbox) {
      previousVisibilityRef.current = state.sidebar.visible
      previousActiveIndexRef.current = activeIndex
      return
    }

    if (!previousVisibilityRef.current && state.activeTabId) {
      scrollbox.scrollChildIntoView(`sidebar-tab-${state.activeTabId}`)
      previousVisibilityRef.current = true
      previousActiveIndexRef.current = activeIndex
      return
    }

    const scrollTarget = getSidebarScrollTarget({
      previousActiveIndex: previousActiveIndexRef.current,
      nextActiveIndex: activeIndex,
      tabCount: state.tabs.length,
    })

    if (scrollTarget === 'top') {
      scrollbox.scrollTo({ x: 0, y: 0 })
    } else if (scrollTarget === 'bottom') {
      scrollbox.scrollTo({ x: 0, y: scrollbox.scrollHeight })
    } else if (scrollTarget === 'active-item' && state.activeTabId) {
      scrollbox.scrollChildIntoView(`sidebar-tab-${state.activeTabId}`)
    }

    previousVisibilityRef.current = state.sidebar.visible
    previousActiveIndexRef.current = activeIndex
  }, [activeIndex, state.activeTabId, state.sidebar.visible, state.tabs.length])

  if (!state.sidebar.visible) {
    return null
  }

  return (
    <box
      width={state.sidebar.width}
      border
      borderColor={state.focusMode === 'navigation' ? theme.borderActive : theme.border}
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
      <text fg={theme.dim}>{'─'.repeat(Math.max(0, state.sidebar.width - 2))}</text>
      <scrollbox
        paddingTop={0}
        ref={scrollRef}
        flexGrow={1}
        scrollY
        viewportCulling
        contentOptions={{ flexDirection: 'column', gap: 0 }}
      >
        {state.tabs.length === 0 ? (
          <box paddingTop={1}>
            <text fg={theme.textMuted}>No tabs yet. Press Ctrl+n.</text>
          </box>
        ) : (
          state.tabs.map((tab) => {
            const layoutIds = state.layoutTree ? allLeafIds(state.layoutTree) : []
            const isInLayout = layoutIds.includes(tab.id)
            return (
              <box
                key={tab.id}
                onMouseDown={onTabActivate ? () => onTabActivate(tab.id) : undefined}
              >
                <TabItem
                  id={`sidebar-tab-${tab.id}`}
                  tab={tab}
                  active={tab.id === state.activeTabId}
                  focused={state.focusMode === 'navigation'}
                  isFocusedInput={
                    tab.id === state.activeTabId && state.focusMode === 'terminal-input'
                  }
                  inLayout={isInLayout && layoutIds.length > 1}
                />
              </box>
            )
          })
        )}
      </scrollbox>
    </box>
  )
}

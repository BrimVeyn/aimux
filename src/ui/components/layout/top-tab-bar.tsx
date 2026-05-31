import type { MouseEvent as OtuiMouseEvent, ScrollBoxRenderable } from '@opentui/core'

import { memo, type ReactNode, useCallback, useMemo, useRef } from 'react'

import type { BranchDivergence, TabSession, WorktreeRecord } from '../../../state/types'

import { useWorktreeDivergencePolling } from '../../../git/worktree-divergence-poller'
import { useAppStore } from '../../../state/app-store'
import { dispatchGlobal } from '../../../state/dispatch-ref'
import {
  getRenderedTabWorktreeId,
  getWorktreeColor,
  orderTabsByWorktree,
} from '../../../state/session-worktrees'
import { useTheme } from '../../theme'
import { buildTabGroupInfo } from './sidebar/sidebar-group-metadata'
import { TabItem } from './sidebar/tab-item'
import { useTopTabBarAutoScroll } from './sidebar/use-top-tab-bar-auto-scroll'

interface TopTabBarProps {
  forceVisible?: boolean
}

const WORKTREE_STRIP = '▍'
const ROW_CONTENT_OPTIONS = {
  flexDirection: 'row' as const,
  gap: 0,
  justifyContent: 'flex-start' as const,
}

function formatDivergence(divergence: BranchDivergence | undefined): string {
  if (divergence == null) return ''
  const parts: string[] = []
  if (divergence.ahead > 0) parts.push(`↑${divergence.ahead}`)
  if (divergence.behind > 0) parts.push(`↓${divergence.behind}`)
  return parts.join(' ')
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
      // marker prop so devtools can locate the active tab; harmless otherwise
      data-active={active ? 'true' : undefined}
    >
      {children}
    </box>
  )
})

function WorktreeGroupChip({
  branch,
  color,
  divergence,
}: {
  branch: string
  color: string
  divergence: string
}) {
  const t = useTheme()
  return (
    <box flexDirection="row" flexShrink={0} paddingLeft={1} paddingRight={1} alignItems="center">
      <text fg={color} selectable={false} wrapMode="none">
        {WORKTREE_STRIP} {branch}
      </text>
      {divergence !== '' ? (
        <text fg={t.textMuted} selectable={false} wrapMode="none">
          {' '}
          {divergence}
        </text>
      ) : null}
    </box>
  )
}

interface WorktreeContextOptions {
  worktrees: WorktreeRecord[]
  worktreeById: Map<string, WorktreeRecord>
}

function getWorktreeContext(
  tab: TabSession,
  options: WorktreeContextOptions
): {
  tabWorktree: WorktreeRecord | undefined
  tabOwnWorktree: WorktreeRecord | undefined
  moveWorktreeId: string | undefined
} {
  const { worktreeById, worktrees } = options
  const tabOwnWorktree =
    tab.worktreeId != null && tab.worktreeId !== '' ? worktreeById.get(tab.worktreeId) : undefined
  let tabWorktree = tabOwnWorktree
  if (!tabWorktree && worktrees.length > 1) {
    tabWorktree = worktrees[0]
  }
  const moveWorktreeId =
    tabOwnWorktree?.branch != null && tabOwnWorktree.branch !== '' && worktrees.length > 1
      ? tabOwnWorktree.id
      : undefined
  return { moveWorktreeId, tabOwnWorktree, tabWorktree }
}

export function TopTabBar({ forceVisible = false }: TopTabBarProps) {
  const t = useTheme()
  const headerBg = t.backgroundPanel
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const bar = useAppStore((s) => s.sessionBar)
  const currentSessionId = useAppStore((s) => s.currentSessionId)
  const sessions = useAppStore((s) => s.sessions)
  const worktreeDivergence = useAppStore((s) => s.worktreeDivergence)
  const focusMode = useAppStore((s) => s.focusMode)
  const layoutTrees = useAppStore((s) => s.layoutTrees)

  useWorktreeDivergencePolling(bar.visible || forceVisible)

  const currentSession = useMemo(
    () =>
      currentSessionId != null && currentSessionId !== ''
        ? sessions.find((s) => s.id === currentSessionId)
        : undefined,
    [currentSessionId, sessions]
  )
  const worktrees = useMemo(() => currentSession?.worktrees ?? [], [currentSession?.worktrees])
  const worktreeById = useMemo(
    () => new Map(worktrees.map((worktree) => [worktree.id, worktree])),
    [worktrees]
  )

  const groupedTabs = useMemo(
    () => orderTabsByWorktree(tabs, currentSession),
    [tabs, currentSession]
  )

  const showWorktreeSeparators = useMemo(() => {
    const ids = new Set<string>()
    for (const tab of groupedTabs) {
      ids.add(getRenderedTabWorktreeId(tab, worktrees))
    }
    if (currentSession?.activeWorktreeId != null && currentSession.activeWorktreeId !== '') {
      ids.add(currentSession.activeWorktreeId)
    }
    return ids.size >= 2
  }, [currentSession, groupedTabs, worktrees])

  const tabGroupInfo = useMemo(
    () => buildTabGroupInfo(layoutTrees, groupedTabs),
    [layoutTrees, groupedTabs]
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

  if ((!bar.visible && !forceVisible) || groupedTabs.length === 0) return null

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
        {groupedTabs.map((tab, index) => {
          const isActive = tab.id === activeTabId
          const info = tabGroupInfo.get(tab.id)
          const inLayout = !!(info?.inLayout === true)
          const prevTab = groupedTabs[index - 1]
          const startsWorktreeGroup =
            !prevTab ||
            getRenderedTabWorktreeId(prevTab, worktrees) !==
              getRenderedTabWorktreeId(tab, worktrees)

          const { moveWorktreeId, tabWorktree } = getWorktreeContext(tab, {
            worktreeById,
            worktrees,
          })
          const worktreeColor = tabWorktree
            ? (tabWorktree.color ?? getWorktreeColor(tabWorktree.id))
            : t.textMuted
          const worktreeLabel = tabWorktree?.branch ?? tabWorktree?.name ?? 'main'
          const divergence = formatDivergence(
            tabWorktree != null ? worktreeDivergence[tabWorktree.id] : undefined
          )

          return (
            <box key={tab.id} flexDirection="row" flexShrink={0}>
              {showWorktreeSeparators && startsWorktreeGroup ? (
                <WorktreeGroupChip
                  branch={worktreeLabel}
                  color={worktreeColor}
                  divergence={divergence}
                />
              ) : null}
              <TopTabCell
                tabId={tab.id}
                active={isActive}
                onActivate={handleTabActivate}
                backgroundColor={isActive ? t.backgroundElement : undefined}
              >
                {showWorktreeSeparators ? (
                  <text fg={worktreeColor} selectable={false} wrapMode="none">
                    {WORKTREE_STRIP}
                  </text>
                ) : null}
                <TabItem
                  id={`top-tab-${tab.id}`}
                  tab={tab}
                  active={isActive}
                  focused={focusMode === 'terminal-input' || focusMode === 'navigation'}
                  inLayout={inLayout}
                  moveWorktreeId={moveWorktreeId}
                />
              </TopTabCell>
            </box>
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

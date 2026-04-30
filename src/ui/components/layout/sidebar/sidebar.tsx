import {
  type BoxRenderable,
  type MouseEvent as OtuiMouseEvent,
  type ScrollBoxRenderable,
} from '@opentui/core'
import { memo, useMemo, useRef } from 'react'

import { useAppStore } from '../../../../state/app-store'
import { dispatchGlobal } from '../../../../state/dispatch-ref'
import {
  getActiveWorktree,
  getRenderedTabWorktreeId,
  getSessionProjectPath,
  getWorktreeColor,
  orderTabsByWorktree,
} from '../../../../state/session-worktrees'
import { getCurrentTheme, type ResolvedTuiTheme, useTheme } from '../../../theme'
import { buildGitPaneContextMenu } from '../../git/pane/git-pane-context-menu'
import { GitPaneWidget } from '../../git/pane/git-pane-widget'
import { ContextMenuBox } from '../../overlays/context-menu/context-menu-box'
import { buildTabGroupInfo } from './sidebar-group-metadata'
import { TabItem } from './tab-item'
import { useSidebarAutoScroll } from './use-sidebar-auto-scroll'
import { useSidebarBranch } from './use-sidebar-branch'

interface SidebarProps {
  onTabActivate?: (tabId: string) => void
  onResizeDrag?: (event: OtuiMouseEvent) => boolean
  onResizeDragEnd?: () => void
  onSidebarResizeStart?: (info: { initialWidth: number; screenStart: number }) => void
  onEmbeddedGitResizeStart?: (info: {
    containerStart: number
    position: 'top' | 'bottom'
    totalSize: number
  }) => void
}

const GUTTER_START = '╭'
const GUTTER_MIDDLE = '├'
const GUTTER_END = '╰'
const GUTTER_PAD = '│'
const RESIZE_HANDLE = '│'

function getRowBackground({
  alternate,
  isActive,
  t,
}: {
  isActive: boolean
  alternate: boolean
  t: ResolvedTuiTheme
}): string | undefined {
  if (isActive) return t.backgroundElement
  if (alternate) return t.backgroundPanel
  return t.backgroundPanel
}

const SidebarTop = memo(function SidebarTop({ contentWidth }: { contentWidth: number }) {
  const t = useTheme()
  const currentSessionId = useAppStore((s) => s.currentSessionId)
  const sessions = useAppStore((s) => s.sessions)
  const currentSession = currentSessionId
    ? sessions.find((s) => s.id === currentSessionId)
    : undefined
  const activeWorktree = getActiveWorktree(currentSession)
  const projectPath = getSessionProjectPath(currentSession)
  const branch = useSidebarBranch(projectPath)

  return (
    <box flexDirection="column" flexShrink={0} gap={0}>
      <text fg={t.text}>
        <strong>aimux</strong>
      </text>
      <text fg={t.text}>{currentSession ? currentSession.name : 'No workspace selected'}</text>
      {branch || activeWorktree ? (
        <box flexDirection="row">
          <text fg={t.text}>{'\u{e702}'} </text>
          <text fg={t.text}>{branch ?? activeWorktree?.branch ?? activeWorktree?.name}</text>
          {activeWorktree?.source === 'aimux-temp' ? <text fg={t.textMuted}> tmp</text> : null}
        </box>
      ) : null}
      <box
        flexDirection="row"
        paddingY={1}
        backgroundColor={t.backgroundPanel}
        justifyContent="center"
        marginTop={1}
        onMouseDown={(e) => {
          e.stopPropagation()
          dispatchGlobal({ type: 'open-new-tab-modal' })
        }}
      >
        <text fg={t.text}>+ New assistant</text>
      </box>
      <text fg={t.textMuted}>{'·'.repeat(Math.max(0, contentWidth - 2))}</text>
    </box>
  )
})

function renderGroupGutter(isGroupStart: boolean, isGroupMiddle: boolean, isGroupEnd: boolean) {
  const t = getCurrentTheme()
  return (
    <box flexDirection="column" width={1} overflow="hidden">
      <text fg={t.border}>
        {/* oxlint-disable-next-line no-nested-ternary */}
        {isGroupStart ? GUTTER_START : isGroupMiddle ? GUTTER_MIDDLE : GUTTER_PAD}
      </text>
      <text fg={t.border}>{isGroupEnd ? GUTTER_END : GUTTER_PAD}</text>
    </box>
  )
}

interface TabsBodyProps {
  onTabActivate?: (tabId: string) => void
}

const TabsBody = memo(function TabsBody({ onTabActivate }: TabsBodyProps) {
  const t = useTheme()
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const focusMode = useAppStore((s) => s.focusMode)
  const layoutTrees = useAppStore((s) => s.layoutTrees)
  const sidebarVisible = useAppStore((s) => s.sidebar.visible)
  const currentSessionId = useAppStore((s) => s.currentSessionId)
  const sessions = useAppStore((s) => s.sessions)
  const currentSession = currentSessionId
    ? sessions.find((s) => s.id === currentSessionId)
    : undefined
  const worktrees = useMemo(() => currentSession?.worktrees ?? [], [currentSession?.worktrees])
  const worktreeById = useMemo(
    () => new Map(worktrees.map((worktree) => [worktree.id, worktree])),
    [worktrees]
  )
  const groupedTabs = useMemo(() => {
    return orderTabsByWorktree(tabs, currentSession)
  }, [currentSession, tabs])
  const showWorktreeSeparators = useMemo(() => {
    const ids = new Set<string>()
    for (const tab of groupedTabs) {
      ids.add(getRenderedTabWorktreeId(tab, worktrees))
    }
    const activeWorktreeId =
      currentSession?.activeWorktreeId ?? getActiveWorktree(currentSession)?.id
    if (activeWorktreeId) ids.add(activeWorktreeId)
    return ids.size >= 2
  }, [currentSession, groupedTabs, worktrees])

  const scrollRef = useRef<ScrollBoxRenderable | null>(null)
  const activeIndex = groupedTabs.findIndex((tab) => tab.id === activeTabId)
  const tabGroupInfo = useMemo(
    () => buildTabGroupInfo(layoutTrees, groupedTabs),
    [layoutTrees, groupedTabs]
  )

  useSidebarAutoScroll({
    activeIndex,
    activeTabId,
    scrollRef,
    tabCount: groupedTabs.length,
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
          <text fg={t.textMuted}>No tabs yet. Press Ctrl+n.</text>
        </box>
      ) : (
        groupedTabs.map((tab, index) => {
          const isActive = tab.id === activeTabId
          const alternate = index % 2 === 1
          const info = tabGroupInfo.get(tab.id)
          const inLayout = !!info?.inLayout
          const inGroup = info ? index >= info.groupStart && index <= info.groupEnd : false
          const isGroupStart = info ? index === info.groupStart : false
          const isGroupEnd = info ? index === info.groupEnd : false
          const isGroupMiddle = inGroup && !isGroupStart && !isGroupEnd
          let tabWorktree = tab.worktreeId ? worktreeById.get(tab.worktreeId) : undefined
          if (!tabWorktree && worktrees.length > 1) {
            tabWorktree = worktrees[0]
          }
          const prevTab = groupedTabs[index - 1]
          const startsWorktreeGroup =
            getRenderedTabWorktreeId(prevTab ?? {}, worktrees) !==
            getRenderedTabWorktreeId(tab, worktrees)
          const worktreeColor = tabWorktree
            ? (tabWorktree.color ?? getWorktreeColor(tabWorktree.id))
            : t.textMuted
          const worktreeLabel = tabWorktree?.branch ?? tabWorktree?.name ?? 'main'

          return (
            <box key={tab.id} flexDirection="column">
              {showWorktreeSeparators && startsWorktreeGroup ? (
                <box flexDirection="row" paddingTop={index === 0 ? 0 : 1} paddingLeft={1}>
                  <text fg={worktreeColor}>┃ </text>
                  <text fg={worktreeColor}>{worktreeLabel}</text>
                  <text fg={t.textMuted}> {'─'.repeat(12)}</text>
                </box>
              ) : null}
              <box
                backgroundColor={getRowBackground({ alternate, isActive, t })}
                flexDirection="row"
                onMouseDown={(event) => {
                  event.stopPropagation()
                  onTabActivate?.(tab.id)
                }}
              >
                {inGroup ? renderGroupGutter(isGroupStart, isGroupMiddle, isGroupEnd) : null}
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
            </box>
          )
        })
      )}
    </scrollbox>
  )
})

export function Sidebar({
  onEmbeddedGitResizeStart,
  onResizeDrag,
  onResizeDragEnd,
  onSidebarResizeStart,
  onTabActivate,
}: SidebarProps) {
  const t = useTheme()
  const sidebarBg = t.background
  const sidebarVisible = useAppStore((s) => s.sidebar.visible)
  const sidebarWidth = useAppStore((s) => s.sidebar.width)
  const gitPane = useAppStore((s) => s.gitPane)
  const focusMode = useAppStore((s) => s.focusMode)
  const bodyRef = useRef<BoxRenderable | null>(null)

  if (!sidebarVisible) {
    return null
  }

  const gitEmbedded = gitPane.mode === 'embedded' && gitPane.visible
  const gitOnTop = gitEmbedded && gitPane.position === 'top'
  const gitOnBottom = gitEmbedded && gitPane.position === 'bottom'
  const contentWidth = Math.max(1, sidebarWidth - 1)
  const gitPaneMenu = buildGitPaneContextMenu(
    gitPane,
    () => dispatchGlobal({ type: 'toggle-git-pane' }),
    (mode, position) => {
      dispatchGlobal({ mode, type: 'set-git-pane-mode' })
      dispatchGlobal({ position, type: 'set-git-pane-position' })
    }
  )

  // flex-grow scaled by 100 (integer preferred); tabs gets (1-ratio), git gets ratio.
  const tabsGrow = gitEmbedded ? Math.max(1, Math.round((1 - gitPane.embeddedRatio) * 100)) : 1
  const gitGrow = gitEmbedded ? Math.max(1, Math.round(gitPane.embeddedRatio * 100)) : 0

  const separator = <text fg={t.textMuted}>{'·'.repeat(Math.max(0, contentWidth - 2))}</text>
  const gitBody = gitEmbedded ? (
    <ContextMenuBox
      flexDirection="column"
      flexGrow={gitGrow}
      flexShrink={1}
      flexBasis={0}
      overflow="hidden"
      rightClickMenu={gitPaneMenu}
    >
      <GitPaneWidget pollingEnabled={gitPane.visible} />
    </ContextMenuBox>
  ) : null
  const embeddedHandle = gitEmbedded ? (
    <box
      minHeight={1}
      flexShrink={0}
      backgroundColor={t.border}
      onMouseDown={(event) => {
        const body = bodyRef.current
        if (!body) return
        event.preventDefault()
        event.stopPropagation()
        onEmbeddedGitResizeStart?.({
          containerStart: body.y,
          position: gitPane.position === 'top' ? 'top' : 'bottom',
          totalSize: Math.max(1, body.height),
        })
      }}
    >
      <text fg={t.border}>{RESIZE_HANDLE.repeat(Math.max(1, contentWidth))}</text>
    </box>
  ) : null

  return (
    <ContextMenuBox
      width={sidebarWidth}
      padding={0}
      flexDirection="column"
      backgroundColor={sidebarBg}
      gap={0}
      overflow="hidden"
      rightClickMenu={[
        ['Hide sidebar', () => dispatchGlobal({ type: 'toggle-sidebar' })],
        ['Toggle git pane', () => dispatchGlobal({ type: 'toggle-git-pane' })],
        [
          'Toggle diff mode',
          () => {
            dispatchGlobal({ type: 'enter-git-mode' })
            dispatchGlobal({ type: 'git-mode-toggle-diff-view' })
          },
        ],
      ]}
      onMouseDown={() => {
        if (focusMode === 'terminal-input') {
          dispatchGlobal({ focusMode: 'navigation', type: 'set-focus-mode' })
        }
      }}
      onMouseDrag={(event) => {
        if (onResizeDrag?.(event)) {
          event.preventDefault()
          event.stopPropagation()
        }
      }}
      onMouseUp={() => {
        onResizeDragEnd?.()
      }}
    >
      <box flexDirection="row" width={sidebarWidth} flexGrow={1} overflow="hidden">
        <box width={contentWidth} flexGrow={1} flexDirection="column" overflow="hidden">
          <SidebarTop contentWidth={contentWidth} />
          <box ref={bodyRef} flexDirection="column" flexGrow={1} overflow="hidden">
            {gitOnTop ? (
              <>
                {gitBody}
                {embeddedHandle}
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
                {embeddedHandle}
                {gitBody}
              </>
            ) : null}
          </box>
          {!gitEmbedded ? separator : null}
        </box>
        <box
          height="100%"
          width={1}
          flexShrink={0}
          backgroundColor={t.border}
          onMouseDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onSidebarResizeStart?.({ initialWidth: sidebarWidth, screenStart: event.x })
          }}
        />
      </box>
    </ContextMenuBox>
  )
}

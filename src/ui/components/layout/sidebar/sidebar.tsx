import type { BoxRenderable, MouseEvent as OtuiMouseEvent } from '@opentui/core'

import { useCallback, useMemo, useRef } from 'react'

import { useAppStore } from '../../../../state/app-store'
import { dispatchGlobal } from '../../../../state/dispatch-ref'
import { useTheme } from '../../../theme'
import { buildGitPaneContextMenu } from '../../git/pane/git-pane-context-menu'
import { GitPaneWidget } from '../../git/pane/git-pane-widget'
import { ContextMenuBox } from '../../overlays/context-menu/context-menu-box'
import { WorkspaceList } from './workspace-list'

interface SidebarProps {
  onResizeDrag?: (event: OtuiMouseEvent) => boolean
  onResizeDragEnd?: () => void
  onEmbeddedGitResizeStart?: (info: {
    containerStart: number
    position: 'top' | 'bottom'
    totalSize: number
  }) => void
}

const RESIZE_HANDLE = '─'

export function Sidebar({ onEmbeddedGitResizeStart, onResizeDrag, onResizeDragEnd }: SidebarProps) {
  const t = useTheme()
  const sidebarBg = t.background
  const sidebarVisible = useAppStore((s) => s.sidebar.visible)
  const sidebarWidth = useAppStore((s) => s.sidebar.width)
  const gitPane = useAppStore((s) => s.gitPane)
  const focusMode = useAppStore((s) => s.focusMode)
  const bodyRef = useRef<BoxRenderable | null>(null)

  const handleSidebarMouseDown = useCallback(() => {
    if (focusMode === 'terminal-input') {
      dispatchGlobal({ focusMode: 'navigation', type: 'set-focus-mode' })
    }
  }, [focusMode])
  const handleSidebarMouseDrag = useCallback(
    (event: OtuiMouseEvent) => {
      if (onResizeDrag?.(event) === true) {
        event.preventDefault()
        event.stopPropagation()
      }
    },
    [onResizeDrag]
  )
  const handleSidebarMouseUp = useCallback(() => {
    onResizeDragEnd?.()
  }, [onResizeDragEnd])
  const handleEmbeddedHandleMouseDown = useCallback(
    (event: OtuiMouseEvent) => {
      const body = bodyRef.current
      if (!body) return
      event.preventDefault()
      event.stopPropagation()
      onEmbeddedGitResizeStart?.({
        containerStart: body.y,
        position: gitPane.position === 'top' ? 'top' : 'bottom',
        totalSize: Math.max(1, body.height),
      })
    },
    [gitPane.position, onEmbeddedGitResizeStart]
  )
  const sidebarMenu = useMemo<[string, () => void][]>(
    () => [
      ['Hide sidebar', () => dispatchGlobal({ type: 'toggle-sidebar' })],
      ['Toggle git pane', () => dispatchGlobal({ type: 'toggle-git-pane' })],
      [
        'Toggle diff mode',
        () => {
          dispatchGlobal({ type: 'enter-git-mode' })
          dispatchGlobal({ type: 'git-mode-toggle-diff-view' })
        },
      ],
    ],
    []
  )

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

  // flex-grow scaled by 100 (integer preferred); workspace list gets (1-ratio), git gets ratio.
  const listGrow = gitEmbedded ? Math.max(1, Math.round((1 - gitPane.embeddedRatio) * 100)) : 1
  const gitGrow = gitEmbedded ? Math.max(1, Math.round(gitPane.embeddedRatio * 100)) : 0

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
    <box minHeight={1} flexShrink={0} onMouseDown={handleEmbeddedHandleMouseDown}>
      <text fg={t.border} selectable={false}>
        {RESIZE_HANDLE.repeat(Math.max(1, contentWidth))}
      </text>
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
      rightClickMenu={sidebarMenu}
      onMouseDown={handleSidebarMouseDown}
      onMouseDrag={handleSidebarMouseDrag}
      onMouseUp={handleSidebarMouseUp}
    >
      <box flexDirection="row" width={sidebarWidth} flexGrow={1} overflow="hidden">
        <box width={contentWidth} flexGrow={1} flexDirection="column" overflow="hidden">
          <box ref={bodyRef} flexDirection="column" flexGrow={1} overflow="hidden">
            {gitOnTop ? (
              <>
                {gitBody}
                {embeddedHandle}
              </>
            ) : null}
            <box
              flexDirection="column"
              flexGrow={listGrow}
              flexShrink={1}
              flexBasis={0}
              overflow="hidden"
            >
              <WorkspaceList contentWidth={contentWidth} />
            </box>
            {gitOnBottom ? (
              <>
                {embeddedHandle}
                {gitBody}
              </>
            ) : null}
          </box>
        </box>
      </box>
    </ContextMenuBox>
  )
}

import type { MouseEvent } from '@opentui/core'

import type { TerminalContentOrigin } from '../input/raw-input-handler'
import type { FocusMode, ModalState, SessionRecord, SnippetRecord } from '../state/types'
import type { ThemeId } from './themes'

import { useAppStore } from '../state/app-store'
import { dispatchGlobal } from '../state/dispatch-ref'
import { getGitPaneWidthFromRatio } from '../state/git-pane-sizing'
import { getTreeForTab, PANE_BORDER, type SplitDirection } from '../state/layout-tree'
import { GitView } from './components/git/git-view'
import { buildGitPaneContextMenu } from './components/git/pane/git-pane-context-menu'
import { GitPaneWidget } from './components/git/pane/git-pane-widget'
import { SessionBar } from './components/layout/session-bar'
import { Sidebar } from './components/layout/sidebar/sidebar'
import { SplitLayout } from './components/layout/split-layout'
import { StatusBar } from './components/layout/status-bar'
import { TerminalPane } from './components/layout/terminal-pane'
import { AIUsageModal } from './components/modals/app/ai-usage-modal'
import { HelpModal } from './components/modals/app/help-modal'
import { UpdateAvailableModal } from './components/modals/app/update-available-modal'
import { GitCommitModal } from './components/modals/git/git-commit-modal'
import { CreateSessionModal } from './components/modals/sessions/create-session-modal'
import { SessionNameModal } from './components/modals/sessions/session-name-modal'
import { SessionPickerModal } from './components/modals/sessions/session-picker-modal'
import { SnippetEditorModal } from './components/modals/snippets/snippet-editor-modal'
import { SnippetPickerModal } from './components/modals/snippets/snippet-picker-modal'
import { NewTabModal } from './components/modals/tabs/new-tab-modal'
import { ThemePickerModal } from './components/modals/themes/theme-picker-modal'
import { ContextMenuBox } from './components/overlays/context-menu/context-menu-box'
import { ContextMenuOverlay } from './components/overlays/context-menu/context-menu-overlay'
import { PendingChordOverlay } from './components/overlays/pending-chord-overlay'
import { useTheme } from './theme'

function getCreateSessionFields(modal: ModalState) {
  if (modal.type !== 'create-session') {
    return { directoryQuery: '', sessionName: '' }
  }

  if (modal.activeField === 'directory') {
    return {
      directoryQuery: modal.editBuffer ?? '',
      sessionName: modal.nameBuffer,
    }
  }

  return {
    directoryQuery: modal.nameBuffer,
    sessionName: modal.editBuffer ?? '',
  }
}

function getSnippetEditorFields(modal: ModalState) {
  if (modal.type !== 'snippet-editor') {
    return { snippetContent: '', snippetName: '', snippetTrigger: '' }
  }

  const editValue = modal.editBuffer ?? ''
  return {
    snippetContent: modal.activeField === 'content' ? editValue : modal.contentBuffer,
    snippetName: modal.activeField === 'name' ? editValue : modal.nameBuffer,
    snippetTrigger: modal.activeField === 'trigger' ? editValue : modal.triggerBuffer,
  }
}

function renderModal(
  modal: ModalState,
  options: {
    customCommands: Record<string, string>
    sessions: SessionRecord[]
    currentSessionId: string | null
    currentTabCount: number
    snippets: SnippetRecord[]
    themeId: ThemeId
    createSessionFields: { directoryQuery: string; sessionName: string }
    snippetEditorFields: { snippetName: string; snippetTrigger: string; snippetContent: string }
    focusMode: FocusMode
    activeAssistant?: string
    autoCommitModel?: string
  }
) {
  switch (modal.type) {
    case 'new-tab':
    case 'split-picker':
      return (
        <NewTabModal
          selectedIndex={modal.selectedIndex}
          customCommands={options.customCommands}
          filter={modal.editBuffer}
          cursorPos={modal.cursorPos}
          editingCommand={modal.type === 'new-tab' ? modal.editingCommand : null}
          editBuffer={modal.editBuffer ?? ''}
        />
      )
    case 'session-picker':
      return (
        <SessionPickerModal
          sessions={options.sessions}
          selectedIndex={modal.selectedIndex}
          currentSessionId={options.currentSessionId}
          currentTabCount={options.currentTabCount}
          filter={modal.editBuffer}
          cursorPos={modal.cursorPos}
        />
      )
    case 'session-name':
      return (
        <SessionNameModal
          title={modal.sessionTargetId ? 'Rename workspace' : 'Create workspace'}
          value={modal.editBuffer ?? ''}
        />
      )
    case 'rename-tab':
      return <SessionNameModal title="Rename tab" value={modal.editBuffer ?? ''} />
    case 'create-session':
      return (
        <CreateSessionModal
          activeField={modal.activeField}
          directoryQuery={options.createSessionFields.directoryQuery}
          sessionName={options.createSessionFields.sessionName}
          results={modal.directoryResults}
          selectedIndex={modal.selectedIndex}
          pendingProjectPath={modal.pendingProjectPath}
        />
      )
    case 'snippet-picker':
      return (
        <SnippetPickerModal
          snippets={options.snippets}
          selectedIndex={modal.selectedIndex}
          filter={modal.editBuffer}
          cursorPos={modal.cursorPos}
          actionMessage={modal.actionMessage}
        />
      )
    case 'snippet-editor':
      return (
        <SnippetEditorModal
          activeField={modal.activeField}
          snippetName={options.snippetEditorFields.snippetName}
          snippetTrigger={options.snippetEditorFields.snippetTrigger}
          snippetContent={options.snippetEditorFields.snippetContent}
          isEditing={modal.sessionTargetId !== null}
        />
      )
    case 'theme-picker':
      return (
        <ThemePickerModal
          selectedIndex={modal.selectedIndex}
          currentThemeId={options.themeId}
          filter={modal.editBuffer}
          cursorPos={modal.cursorPos}
        />
      )
    case 'update-available':
      return (
        <UpdateAvailableModal
          selectedIndex={modal.selectedIndex}
          currentVersion={modal.currentVersion}
          latestVersion={modal.latestVersion}
        />
      )
    case 'help':
      return (
        <HelpModal
          filter={modal.editBuffer}
          selectedIndex={modal.selectedIndex}
          scope={modal.scope}
          cursorPos={modal.cursorPos}
        />
      )
    case 'ai-usage':
      return <AIUsageModal />
    case 'git-commit': {
      const titleText =
        modal.activeField === 'title' ? (modal.editBuffer ?? '') : modal.contentBuffer
      const bodyText =
        modal.activeField === 'title' ? modal.contentBuffer : (modal.editBuffer ?? '')
      return (
        <GitCommitModal
          activeField={modal.activeField}
          assistant={options.activeAssistant}
          body={bodyText}
          cursorPos={modal.cursorPos ?? (modal.editBuffer ?? '').length}
          model={options.autoCommitModel}
          stage={modal.stage}
          title={titleText}
        />
      )
    }
    case null:
      return null
    default:
      modal satisfies never
  }
}

interface RootViewProps {
  themeId: ThemeId
  contentOrigin: TerminalContentOrigin
  mouseForwardingEnabled: boolean
  localScrollbackEnabled: boolean
  onTerminalMouseEvent: (event: MouseEvent, origin: TerminalContentOrigin) => void
  onTerminalScrollEvent: (event: MouseEvent) => void
  onTerminalClick?: (event: MouseEvent, origin: TerminalContentOrigin, tabId?: string) => void
  onTerminalDrag?: (event: MouseEvent, origin: TerminalContentOrigin, tabId?: string) => boolean
  onTerminalMouseUp?: (event: MouseEvent) => boolean
  onPaneActivate?: (tabId: string) => void
  onSplitResize?: (tabId: string, ratio: number, axis: SplitDirection) => void
  onSidebarResizeStart?: (info: { initialWidth: number; screenStart: number }) => void
  onGitPaneResizeStart?: (info: {
    initialWidth: number
    screenStart: number
    side: 'left' | 'right'
  }) => void
  onEmbeddedGitResizeStart?: (info: {
    containerStart: number
    position: 'top' | 'bottom'
    totalSize: number
  }) => void
  onSeparatorDragStart?: (info: {
    tabId: string
    direction: SplitDirection
    screenStart: number
    totalSize: number
  }) => void
  onSeparatorDrag?: (event: MouseEvent) => boolean
  onSeparatorDragEnd?: () => void
  terminalCols: number
  terminalRows: number
}

export function RootView({
  contentOrigin,
  localScrollbackEnabled,
  mouseForwardingEnabled,
  onEmbeddedGitResizeStart,
  onGitPaneResizeStart,
  onPaneActivate,
  onSeparatorDrag,
  onSeparatorDragEnd,
  onSeparatorDragStart,
  onSidebarResizeStart,
  onSplitResize,
  onTerminalClick,
  onTerminalDrag,
  onTerminalMouseEvent,
  onTerminalMouseUp,
  onTerminalScrollEvent,
  terminalCols,
  terminalRows,
  themeId,
}: RootViewProps) {
  const t = useTheme()
  const editorBg = t.background
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const layoutTrees = useAppStore((s) => s.layoutTrees)
  const tabGroupMap = useAppStore((s) => s.tabGroupMap)
  const focusMode = useAppStore((s) => s.focusMode)
  const modal = useAppStore((s) => s.modal)
  const snippets = useAppStore((s) => s.snippets)
  const customCommands = useAppStore((s) => s.customCommands)
  const sessions = useAppStore((s) => s.sessions)
  const currentSessionId = useAppStore((s) => s.currentSessionId)
  const sessionBarPosition = useAppStore((s) => s.sessionBar.position)
  const gitPaneMode = useAppStore((s) => s.gitPane.mode)
  const gitPaneVisible = useAppStore((s) => s.gitPane.visible)
  const gitPanePosition = useAppStore((s) => s.gitPane.position)
  const gitPaneRatio = useAppStore((s) => s.gitPane.paneRatio)
  const sidebarWidth = useAppStore((s) => s.sidebar.width)
  const sidebarVisible = useAppStore((s) => s.sidebar.visible)

  const gitPaneInPaneOnLeft = gitPaneMode === 'pane' && gitPaneVisible && gitPanePosition === 'left'
  const handleTerminalLeftEdgeMouseDown =
    sidebarVisible && !gitPaneInPaneOnLeft && onSidebarResizeStart
      ? (event: MouseEvent) => {
          onSidebarResizeStart({ initialWidth: sidebarWidth, screenStart: event.x })
          return true
        }
      : undefined

  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  const activeTree = activeTabId ? getTreeForTab(layoutTrees, tabGroupMap, activeTabId) : null
  const createSessionFields = getCreateSessionFields(modal)
  const snippetEditorFields = getSnippetEditorFields(modal)
  const splitChrome = PANE_BORDER * 2

  const inGitMode = focusMode === 'git' || modal.type === 'git-commit'
  if (inGitMode) {
    return (
      <box flexDirection="column" width="100%" height="100%" backgroundColor={editorBg}>
        {sessionBarPosition === 'top' && <SessionBar forceVisible />}
        <GitView themeId={themeId} />
        {sessionBarPosition === 'bottom' && <SessionBar forceVisible />}
        <StatusBar />
        <PendingChordOverlay />
        <ContextMenuOverlay />
        {renderModal(modal, {
          activeAssistant: activeTab?.assistant,
          createSessionFields,
          currentSessionId,
          currentTabCount: tabs.length,
          customCommands,
          focusMode,
          sessions,
          snippetEditorFields,
          snippets,
          themeId,
        })}
      </box>
    )
  }

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor={editorBg}
      onMouseDrag={(event) => {
        if (onSeparatorDrag?.(event)) {
          event.preventDefault()
          event.stopPropagation()
        }
      }}
      onMouseUp={(event) => {
        // Catch releases that land outside any TerminalPane (sidebar, gap,
        // status bar, …) so an in-flight multi-click drag — and its
        // auto-scroll interval — is always finalised.
        onTerminalMouseUp?.(event)
        onSeparatorDragEnd?.()
      }}
    >
      {sessionBarPosition === 'top' && <SessionBar />}
      <box flexDirection="row" gap={0} padding={0} flexGrow={1}>
        <Sidebar
          onTabActivate={onPaneActivate}
          onEmbeddedGitResizeStart={onEmbeddedGitResizeStart}
          onResizeDrag={onSeparatorDrag}
          onResizeDragEnd={onSeparatorDragEnd}
        />
        {gitPaneMode === 'pane' && gitPaneVisible && gitPanePosition === 'left' ? (
          <GitPaneInPaneMode
            position="left"
            ratio={gitPaneRatio}
            onGitPaneResizeStart={onGitPaneResizeStart}
          />
        ) : null}
        {activeTree && activeTree.type === 'split' ? (
          <SplitLayout
            node={activeTree}
            tabs={tabs}
            activeTabId={activeTabId}
            focusMode={focusMode}
            contentOrigin={{
              cols: terminalCols + splitChrome,
              rows: terminalRows + splitChrome,
              x: contentOrigin.x - PANE_BORDER,
              y: contentOrigin.y - PANE_BORDER,
            }}
            mouseForwardingEnabled={mouseForwardingEnabled}
            localScrollbackEnabled={localScrollbackEnabled}
            onTerminalMouseEvent={onTerminalMouseEvent}
            onTerminalScrollEvent={onTerminalScrollEvent}
            onTerminalClick={onTerminalClick}
            onTerminalDrag={onTerminalDrag}
            onTerminalMouseUp={onTerminalMouseUp}
            onPaneActivate={onPaneActivate}
            onSplitResize={onSplitResize}
            onSeparatorDragStart={onSeparatorDragStart}
            onSeparatorDrag={onSeparatorDrag}
            onSeparatorDragEnd={onSeparatorDragEnd}
            onLeftEdgeMouseDown={handleTerminalLeftEdgeMouseDown}
            bounds={{
              cols: terminalCols + splitChrome,
              rows: terminalRows + splitChrome,
              x: 0,
              y: 0,
            }}
          />
        ) : (
          <TerminalPane
            tab={activeTab}
            tabId={activeTabId ?? undefined}
            isActive
            focusMode={focusMode}
            contentOrigin={contentOrigin}
            mouseForwardingEnabled={mouseForwardingEnabled}
            localScrollbackEnabled={localScrollbackEnabled}
            onTerminalMouseEvent={onTerminalMouseEvent}
            onTerminalScrollEvent={onTerminalScrollEvent}
            onTerminalClick={onTerminalClick}
            onTerminalDrag={onTerminalDrag}
            onTerminalMouseUp={onTerminalMouseUp}
            onPaneActivate={onPaneActivate}
            onLeftEdgeMouseDown={handleTerminalLeftEdgeMouseDown}
          />
        )}
        {gitPaneMode === 'pane' && gitPaneVisible && gitPanePosition === 'right' ? (
          <GitPaneInPaneMode
            position="right"
            ratio={gitPaneRatio}
            onGitPaneResizeStart={onGitPaneResizeStart}
          />
        ) : null}
      </box>
      {sessionBarPosition === 'bottom' && <SessionBar />}
      <StatusBar />
      <PendingChordOverlay />
      <ContextMenuOverlay />
      {renderModal(modal, {
        createSessionFields,
        currentSessionId,
        currentTabCount: tabs.length,
        customCommands,
        focusMode,
        sessions,
        snippetEditorFields,
        snippets,
        themeId,
      })}
    </box>
  )
}

function GitPaneInPaneMode({
  onGitPaneResizeStart,
  position,
  ratio,
}: {
  ratio: number
  position: 'left' | 'right'
  onGitPaneResizeStart?: (info: {
    initialWidth: number
    screenStart: number
    side: 'left' | 'right'
  }) => void
}) {
  const tokens = useTheme()
  const bg = tokens.backgroundPanel
  const gitPane = useAppStore((s) => s.gitPane)
  const width = getGitPaneWidthFromRatio(ratio)
  const contentWidth = Math.max(1, width - 1)
  const gitPaneMenu = buildGitPaneContextMenu(
    gitPane,
    () => dispatchGlobal({ type: 'toggle-git-pane' }),
    (mode, nextPosition) => {
      dispatchGlobal({ mode, type: 'set-git-pane-mode' })
      dispatchGlobal({ position: nextPosition, type: 'set-git-pane-position' })
    }
  )
  const handle = (
    <box
      width={1}
      flexShrink={0}
      backgroundColor={tokens.border}
      onMouseDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onGitPaneResizeStart?.({ initialWidth: width, screenStart: event.x, side: position })
      }}
    />
  )
  return (
    <box flexDirection="column" width={width} flexShrink={0} backgroundColor={bg} overflow="hidden">
      <box flexDirection="row" flexGrow={1} overflow="hidden">
        {position === 'right' ? handle : null}
        <ContextMenuBox
          width={contentWidth}
          flexGrow={1}
          overflow="hidden"
          rightClickMenu={gitPaneMenu}
        >
          <GitPaneWidget pollingEnabled />
        </ContextMenuBox>
        {position === 'left' ? handle : null}
      </box>
    </box>
  )
}

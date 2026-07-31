import type { MouseEvent } from '@opentui/core'

import { useCallback, useMemo } from 'react'

import type { MeasuredPaneRect } from '../app-runtime/use-pane-size-report'
import type { WorktreeTemplate } from '../config'
import type { TerminalContentOrigin } from '../input/raw-input-handler'
import type {
  BarSide,
  FocusMode,
  ModalState,
  SessionRecord,
  SnippetRecord,
  WorktreeRecord,
} from '../state/types'
import type { ThemeId } from './themes'

import { useWorktreeBranchPolling } from '../git/worktree-branch-poller'
import { useAppStore } from '../state/app-store'
import { getBarWidth } from '../state/bars'
import { getTreeForTab, PANE_BORDER, type SplitDirection } from '../state/layout-tree'
import { GitView } from './components/git/git-view'
import { Bar, type BarBoundaryResizeInfo } from './components/layout/bar'
import { SplitLayout } from './components/layout/split-layout'
import { StatusBar } from './components/layout/status-bar'
import { TerminalPane } from './components/layout/terminal-pane'
import { TopTabBar } from './components/layout/top-tab-bar'
import { AIUsageModal } from './components/modals/app/ai-usage-modal'
import { HelpModal } from './components/modals/app/help-modal'
import { UpdateAvailableModal } from './components/modals/app/update-available-modal'
import { GitCommitModal } from './components/modals/git/git-commit-modal'
import { CreateSessionModal } from './components/modals/sessions/create-session-modal'
import { SessionNameModal } from './components/modals/sessions/session-name-modal'
import { SessionPickerModal } from './components/modals/sessions/session-picker-modal'
import { WorktreeDeleteConfirm } from './components/modals/shared/worktree-delete-confirm'
import { SnippetEditorModal } from './components/modals/snippets/snippet-editor-modal'
import { SnippetPickerModal } from './components/modals/snippets/snippet-picker-modal'
import { NewTabModal } from './components/modals/tabs/new-tab-modal'
import { ThemePickerModal } from './components/modals/themes/theme-picker-modal'
import { CreateWorktreeModal } from './components/modals/worktree/create-worktree-modal'
import { WorktreeMoveConfirmModal } from './components/modals/worktree/worktree-move-confirm-modal'
import { WorktreeMoveModal } from './components/modals/worktree/worktree-move-modal'
import { ContextMenuOverlay } from './components/overlays/context-menu/context-menu-overlay'
import { PendingChordOverlay } from './components/overlays/pending-chord-overlay'
import { ToastViewport } from './components/overlays/toast/toast-viewport'
import { useTheme } from './theme'

const EMPTY_WORKTREES: WorktreeRecord[] = []
const EMPTY_BASE_BRANCHES: string[] = []

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
    worktreeDivergence: Record<string, { ahead: number; behind: number }>
    worktreeTemplates: WorktreeTemplate[]
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
          currentSessionId={options.currentSessionId}
          editingCommand={modal.type === 'new-tab' ? modal.editingCommand : null}
          editBuffer={modal.editBuffer ?? ''}
          activeField={modal.type === 'new-tab' ? modal.activeField : 'assistant'}
          branchError={modal.type === 'new-tab' ? modal.branchError : null}
          branchName={modal.type === 'new-tab' ? modal.branchName : ''}
          createWorktree={modal.type === 'new-tab' ? modal.createWorktree : false}
          selectedAssistantId={modal.type === 'new-tab' ? modal.selectedAssistantId : null}
          step={modal.type === 'new-tab' ? modal.step : 'assistant'}
          baseQuery={modal.type === 'new-tab' ? modal.baseQuery : ''}
          baseRef={modal.type === 'new-tab' ? modal.baseRef : ''}
          baseBranches={modal.type === 'new-tab' ? modal.baseBranches : EMPTY_BASE_BRANCHES}
          worktreeDeletePrompt={modal.type === 'new-tab' ? modal.worktreeDeletePrompt : null}
          worktrees={
            options.currentSessionId != null && options.currentSessionId !== ''
              ? (options.sessions.find((session) => session.id === options.currentSessionId)
                  ?.worktrees ?? EMPTY_WORKTREES)
              : EMPTY_WORKTREES
          }
          worktreeName={modal.type === 'new-tab' ? modal.worktreeName : ''}
          worktreeTemplates={options.worktreeTemplates}
          allowTemplateShortcut={modal.type === 'new-tab'}
        />
      )
    case 'create-worktree':
      return (
        <CreateWorktreeModal
          activeField={modal.activeField}
          step={modal.step}
          worktreeName={modal.worktreeName}
          branchName={modal.branchName}
          branchError={modal.branchError}
          baseQuery={modal.baseQuery}
          baseRef={modal.baseRef}
          baseBranches={modal.baseBranches}
          cursorPos={modal.cursorPos}
          selectedIndex={modal.selectedIndex}
          worktrees={
            options.currentSessionId != null && options.currentSessionId !== ''
              ? (options.sessions.find((session) => session.id === options.currentSessionId)
                  ?.worktrees ?? EMPTY_WORKTREES)
              : EMPTY_WORKTREES
          }
          worktreeTemplates={options.worktreeTemplates}
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
          title={
            modal.sessionTargetId != null && modal.sessionTargetId !== ''
              ? 'Rename workspace'
              : 'Create workspace'
          }
          value={modal.editBuffer ?? ''}
        />
      )
    case 'rename-tab':
      return <SessionNameModal title="Rename tab" value={modal.editBuffer ?? ''} />
    case 'rename-worktree':
      return <SessionNameModal title="Rename worktree" value={modal.editBuffer ?? ''} />
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
    case 'worktree-move': {
      const session =
        options.currentSessionId != null && options.currentSessionId !== ''
          ? options.sessions.find((entry) => entry.id === options.currentSessionId)
          : undefined
      return (
        <WorktreeMoveModal
          deleteSource={modal.type === 'worktree-move' ? modal.deleteSource : false}
          divergence={options.worktreeDivergence}
          selectedIndex={modal.selectedIndex}
          sourceWorktreeId={modal.sourceWorktreeId}
          stats={modal.stats}
          worktrees={session?.worktrees ?? EMPTY_WORKTREES}
        />
      )
    }
    case 'worktree-move-confirm':
      return (
        <WorktreeMoveConfirmModal
          variant={modal.variant}
          files={modal.files}
          sourceLabel={modal.sourceLabel}
          targetLabel={modal.targetLabel}
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
    case 'worktree-delete-confirm':
      return (
        <WorktreeDeleteConfirm
          keybindsModeId="modal.worktree-delete-confirm"
          reason={modal.reason}
          worktreeLabel={modal.worktreeLabel}
        />
      )
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
    case 'flash-jump':
      // Pure overlay — rendered inline by FlashLabelBadge inside the rows.
      return null
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
  onBarResizeStart?: (info: { initialWidth: number; screenStart: number; side: BarSide }) => void
  onBarBoundaryResizeStart?: (info: BarBoundaryResizeInfo) => void
  onSeparatorDragStart?: (info: {
    tabId: string
    direction: SplitDirection
    screenStart: number
    totalSize: number
  }) => void
  onSeparatorDrag?: (event: MouseEvent) => boolean
  onSeparatorDragEnd?: () => void
  onMeasure?: (tabId: string, rect: MeasuredPaneRect) => void
  terminalCols: number
  terminalRows: number
}

export function RootView({
  contentOrigin,
  localScrollbackEnabled,
  mouseForwardingEnabled,
  onBarBoundaryResizeStart,
  onBarResizeStart,
  onMeasure,
  onPaneActivate,
  onSeparatorDrag,
  onSeparatorDragEnd,
  onSeparatorDragStart,
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
  const worktreeDivergence = useAppStore((s) => s.worktreeDivergence)
  const worktreeTemplates = useAppStore((s) => s.worktreeTemplates)
  const leftBarWidth = useAppStore((s) => getBarWidth(s.bars.left))

  const splitChrome = PANE_BORDER * 2

  // Keep every worktree's `branch` in state synchronized with the on-disk
  // HEAD so the sidebar (and divergence calc) never reads a stale value.
  useWorktreeBranchPolling(true)

  // The terminal's own left edge stays a drag target for the left bar, so the
  // resize gesture works from either side of the seam.
  const handleLeftBarEdgeResize = useCallback(
    (event: MouseEvent): boolean => {
      onBarResizeStart?.({ initialWidth: leftBarWidth, screenStart: event.x, side: 'left' })
      return true
    },
    [leftBarWidth, onBarResizeStart]
  )
  const handleTerminalLeftEdgeMouseDown =
    leftBarWidth > 0 && onBarResizeStart ? handleLeftBarEdgeResize : undefined

  const handleRootMouseDrag = useCallback(
    (event: MouseEvent) => {
      if (onSeparatorDrag?.(event) === true) {
        event.preventDefault()
        event.stopPropagation()
      }
    },
    [onSeparatorDrag]
  )
  const handleRootMouseUp = useCallback(
    (event: MouseEvent) => {
      // Catch releases that land outside any TerminalPane (sidebar, gap,
      // status bar, …) so an in-flight multi-click drag — and its
      // auto-scroll interval — is always finalised.
      onTerminalMouseUp?.(event)
      onSeparatorDragEnd?.()
    },
    [onSeparatorDragEnd, onTerminalMouseUp]
  )

  const splitContentOrigin = useMemo(
    () => ({
      cols: terminalCols + splitChrome,
      rows: terminalRows + splitChrome,
      x: contentOrigin.x - PANE_BORDER,
      y: contentOrigin.y - PANE_BORDER,
    }),
    [contentOrigin, splitChrome, terminalCols, terminalRows]
  )
  const splitBounds = useMemo(
    () => ({
      cols: terminalCols + splitChrome,
      rows: terminalRows + splitChrome,
      x: 0,
      y: 0,
    }),
    [splitChrome, terminalCols, terminalRows]
  )

  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  const activeTree =
    activeTabId != null && activeTabId !== ''
      ? getTreeForTab(layoutTrees, tabGroupMap, activeTabId)
      : null
  const createSessionFields = getCreateSessionFields(modal)
  const snippetEditorFields = getSnippetEditorFields(modal)

  const inGitMode = focusMode === 'git' || modal.type === 'git-commit'
  if (inGitMode) {
    return (
      <box flexDirection="column" width="100%" height="100%" backgroundColor={editorBg}>
        <TopTabBar forceVisible />
        <GitView themeId={themeId} />
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
          worktreeDivergence,
          worktreeTemplates,
        })}
        <ToastViewport />
      </box>
    )
  }

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor={editorBg}
      onMouseDrag={handleRootMouseDrag}
      onMouseUp={handleRootMouseUp}
    >
      <box flexDirection="row" gap={0} padding={0} flexGrow={1}>
        <Bar
          side="left"
          onBoundaryResizeStart={onBarBoundaryResizeStart}
          onEdgeResizeStart={onBarResizeStart}
          onResizeDrag={onSeparatorDrag}
          onResizeDragEnd={onSeparatorDragEnd}
        />
        <box flexDirection="column" flexGrow={1}>
          <TopTabBar />
          <box flexDirection="row" gap={0} padding={0} flexGrow={1}>
            {activeTree && activeTree.type === 'split' ? (
              <SplitLayout
                node={activeTree}
                tabs={tabs}
                activeTabId={activeTabId}
                focusMode={focusMode}
                contentOrigin={splitContentOrigin}
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
                onMeasure={onMeasure}
                bounds={splitBounds}
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
                onMeasure={onMeasure}
              />
            )}
          </box>
        </box>
        <Bar
          side="right"
          onBoundaryResizeStart={onBarBoundaryResizeStart}
          onEdgeResizeStart={onBarResizeStart}
          onResizeDrag={onSeparatorDrag}
          onResizeDragEnd={onSeparatorDragEnd}
        />
      </box>
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
        worktreeDivergence,
        worktreeTemplates,
      })}
      <ToastViewport />
    </box>
  )
}

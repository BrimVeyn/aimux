import type { MouseEvent } from '@opentui/core'

import { type ReactNode, useCallback, useMemo } from 'react'

import type { MeasuredPaneRect } from '../app-runtime/use-pane-size-report'
import type { TerminalContentOrigin } from '../input/raw-input-handler'
import type {
  BarSide,
  FocusMode,
  ModalState,
  ProjectRecord,
  SnippetRecord,
  WorkspaceRecord,
} from '../state/types'
import type { ThemeId } from './themes'

import { useWorkspaceBranchPolling } from '../git/workspace-branch-poller'
import { useAutoCommitModel } from '../settings/live'
import { useAppStore } from '../state/app-store'
import { getBarWidth } from '../state/bars'
import { getTreeForTab, PANE_BORDER, type SplitDirection } from '../state/layout-tree'
import { GitView } from './components/git/git-view'
import { Bar, type BarBoundaryResizeInfo } from './components/layout/bar'
import { SplitLayout } from './components/layout/split-layout'
import { StatusBar } from './components/layout/status-bar'
import { TerminalPane } from './components/layout/terminal-pane'
import { TopTabBar } from './components/layout/top-tab-bar'
import { HelpModal } from './components/modals/app/help-modal'
import { QuotasModal } from './components/modals/app/quotas-modal'
import { UpdateAvailableModal } from './components/modals/app/update-available-modal'
import { GitCommitModal } from './components/modals/git/git-commit-modal'
import { CreateProjectModal } from './components/modals/projects/create-project-modal'
import { ProjectNameModal } from './components/modals/projects/project-name-modal'
import { ProjectPickerModal } from './components/modals/projects/project-picker-modal'
import { SettingsSearchModal } from './components/modals/settings/settings-search-modal'
import { WorkspaceDeleteConfirm } from './components/modals/shared/workspace-delete-confirm'
import { SnippetEditorModal } from './components/modals/snippets/snippet-editor-modal'
import { SnippetPickerModal } from './components/modals/snippets/snippet-picker-modal'
import { NewTabModal } from './components/modals/tabs/new-tab-modal'
import { ThemePickerModal } from './components/modals/themes/theme-picker-modal'
import { CreateWorkspaceModal } from './components/modals/workspace/create-workspace-modal'
import { WorkspaceMoveConfirmModal } from './components/modals/workspace/workspace-move-confirm-modal'
import { WorkspaceMoveModal } from './components/modals/workspace/workspace-move-modal'
import { ContextMenuOverlay } from './components/overlays/context-menu/context-menu-overlay'
import { PendingChordOverlay } from './components/overlays/pending-chord-overlay'
import { ToastViewport } from './components/overlays/toast/toast-viewport'
import { SettingsView } from './components/settings/settings-view'
import { StatsView } from './components/stats/stats-view'
import { PluginModalHost } from './plugin-modals'
import { PluginViewHost } from './plugin-views'
import { useTheme } from './theme'

const EMPTY_WORKSPACES: WorkspaceRecord[] = []

function getCreateProjectFields(modal: ModalState) {
  if (modal.type !== 'create-project') {
    return { directoryQuery: '', projectName: '' }
  }

  if (modal.activeField === 'directory') {
    return {
      directoryQuery: modal.editBuffer ?? '',
      projectName: modal.nameBuffer,
    }
  }

  return {
    directoryQuery: modal.nameBuffer,
    projectName: modal.editBuffer ?? '',
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
    projects: ProjectRecord[]
    currentProjectId: string | null
    currentTabCount: number
    snippets: SnippetRecord[]
    themeId: ThemeId
    createProjectFields: { directoryQuery: string; projectName: string }
    snippetEditorFields: { snippetName: string; snippetTrigger: string; snippetContent: string }
    focusMode: FocusMode
    activeAssistant?: string
    autoCommitModel?: string
    workspaceDivergence: Record<string, { ahead: number; behind: number }>
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
          pendingPrompt={modal.type === 'new-tab' ? (modal.pendingWorkspace?.prompt ?? null) : null}
        />
      )
    case 'create-workspace':
      return (
        <CreateWorkspaceModal
          activeField={modal.activeField}
          prompt={modal.prompt}
          branchError={modal.branchError}
          baseQuery={modal.baseQuery}
          baseRef={modal.baseRef}
          baseBranches={modal.baseBranches}
          cursorPos={modal.cursorPos}
          selectedIndex={modal.selectedIndex}
          workspaces={
            options.currentProjectId != null && options.currentProjectId !== ''
              ? (options.projects.find((project) => project.id === options.currentProjectId)
                  ?.workspaces ?? EMPTY_WORKSPACES)
              : EMPTY_WORKSPACES
          }
        />
      )
    case 'project-picker':
      return (
        <ProjectPickerModal
          projects={options.projects}
          selectedIndex={modal.selectedIndex}
          currentProjectId={options.currentProjectId}
          currentTabCount={options.currentTabCount}
          filter={modal.editBuffer}
          cursorPos={modal.cursorPos}
        />
      )
    case 'project-name':
      return (
        <ProjectNameModal
          title={
            modal.projectTargetId != null && modal.projectTargetId !== ''
              ? 'Rename project'
              : 'Create project'
          }
          value={modal.editBuffer ?? ''}
        />
      )
    case 'rename-tab':
      return <ProjectNameModal title="Rename tab" value={modal.editBuffer ?? ''} />
    case 'setting-text':
      return <ProjectNameModal title={modal.settingLabel} value={modal.editBuffer ?? ''} />
    case 'settings-search':
      return (
        <SettingsSearchModal
          filter={modal.editBuffer}
          selectedIndex={modal.selectedIndex}
          cursorPos={modal.cursorPos}
        />
      )
    case 'rename-workspace':
      return <ProjectNameModal title="Rename workspace" value={modal.editBuffer ?? ''} />
    case 'create-project':
      return (
        <CreateProjectModal
          activeField={modal.activeField}
          directoryQuery={options.createProjectFields.directoryQuery}
          projectName={options.createProjectFields.projectName}
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
          isEditing={modal.projectTargetId !== null}
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
    case 'quotas':
      return <QuotasModal />
    case 'update-available':
      return (
        <UpdateAvailableModal
          selectedIndex={modal.selectedIndex}
          currentVersion={modal.currentVersion}
          latestVersion={modal.latestVersion}
        />
      )
    case 'workspace-move': {
      const project =
        options.currentProjectId != null && options.currentProjectId !== ''
          ? options.projects.find((entry) => entry.id === options.currentProjectId)
          : undefined
      return (
        <WorkspaceMoveModal
          deleteSource={modal.type === 'workspace-move' ? modal.deleteSource : false}
          divergence={options.workspaceDivergence}
          selectedIndex={modal.selectedIndex}
          sourceWorkspaceId={modal.sourceWorkspaceId}
          stats={modal.stats}
          workspaces={project?.workspaces ?? EMPTY_WORKSPACES}
        />
      )
    }
    case 'workspace-move-confirm':
      return (
        <WorkspaceMoveConfirmModal
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
    case 'workspace-delete-confirm':
      return (
        <WorkspaceDeleteConfirm
          keybindsModeId="modal.workspace-delete-confirm"
          reason={modal.reason}
          workspaceLabel={modal.workspaceLabel}
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
    case 'plugin-modal':
      return <PluginModalHost modalId={modal.modalId} props={modal.props} />
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
  const activePluginPaneId = useAppStore((s) => s.activePluginPaneId)
  const layoutTrees = useAppStore((s) => s.layoutTrees)
  const tabGroupMap = useAppStore((s) => s.tabGroupMap)
  const focusMode = useAppStore((s) => s.focusMode)
  const modal = useAppStore((s) => s.modal)
  const snippets = useAppStore((s) => s.snippets)
  const customCommands = useAppStore((s) => s.customCommands)
  const projects = useAppStore((s) => s.projects)
  const currentProjectId = useAppStore((s) => s.currentProjectId)
  const workspaceDivergence = useAppStore((s) => s.workspaceDivergence)
  const leftBarWidth = useAppStore((s) => getBarWidth(s.bars.left))

  const splitChrome = PANE_BORDER * 2

  // Keep every workspace's `branch` in state synchronized with the on-disk
  // HEAD so the sidebar (and divergence calc) never reads a stale value.
  useWorkspaceBranchPolling(true)

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
  // The generating overlay has always been able to name the model, and nothing
  // ever passed it one.
  const autoCommitModel = useAutoCommitModel(activeTab?.assistant)
  const activeTree =
    activeTabId != null && activeTabId !== ''
      ? getTreeForTab(layoutTrees, tabGroupMap, activeTabId)
      : null
  const createProjectFields = getCreateProjectFields(modal)
  const snippetEditorFields = getSnippetEditorFields(modal)

  // Git mode and settings each swap the pane tree for one full-width view.
  // Everything else on screen — status bar, overlays, modal, toasts — is the
  // same either way, so only the center is a branch: a return per view would
  // mean maintaining the chrome three times.
  const inGitMode = focusMode === 'git' || modal.type === 'git-commit'
  // A settings row's text field flips focusMode to command-edit, the same way the
  // commit modal does in git mode, so the screen behind it has to stay mounted:
  // those two modals belong to the screen and are read against it.
  //
  // Not `returnTo === 'settings'`, which is where focus goes and not what is
  // behind: the theme picker also returns here, and it previews each theme as you
  // move. Previewing it on the settings screen is not the answer to "how does this
  // theme look" — so it gets the panes, and closing still comes back here.
  const inSettings =
    focusMode === 'settings' || modal.type === 'setting-text' || modal.type === 'settings-search'
  let replacesPanes: ReactNode = null
  if (inGitMode) replacesPanes = <GitView themeId={themeId} />
  else if (inSettings) replacesPanes = <SettingsView />
  // Read-only, so unlike settings it has no modal that belongs to it and no
  // second condition: the screen is up exactly while focus is on it.
  else if (focusMode === 'stats') replacesPanes = <StatsView />
  // A plugin view replaces the panes the same way, and for the same reason:
  // everything else on screen is identical, so only the centre branches.
  else if (focusMode === 'plugin-view') replacesPanes = <PluginViewHost />

  const center =
    replacesPanes !== null ? (
      <>
        <TopTabBar panesReplaced />
        {replacesPanes}
      </>
    ) : (
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
                activePluginPaneId={activePluginPaneId}
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
    )

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor={editorBg}
      // Both drag handlers no-op unless a gesture is in flight, so the full-width
      // views inherit them harmlessly — and a drag that was in flight when one
      // opened gets finalised instead of stranded.
      onMouseDrag={handleRootMouseDrag}
      onMouseUp={handleRootMouseUp}
    >
      {center}
      <StatusBar />
      <PendingChordOverlay />
      <ContextMenuOverlay />
      {renderModal(modal, {
        activeAssistant: activeTab?.assistant,
        autoCommitModel,
        createProjectFields,
        currentProjectId,
        currentTabCount: tabs.length,
        customCommands,
        focusMode,
        projects,
        snippetEditorFields,
        snippets,
        themeId,
        workspaceDivergence,
      })}
      <ToastViewport />
    </box>
  )
}

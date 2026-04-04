import type { MouseEvent } from '@opentui/core'

import type { TerminalContentOrigin } from '../input/raw-input-handler'
import type { ModalState, SessionRecord, SnippetRecord } from '../state/types'
import type { ThemeId } from './themes'

import { useAppStore } from '../state/app-store'
import { getTreeForTab, type SplitDirection } from '../state/layout-tree'
import { CreateSessionModal } from './components/create-session-modal'
import { HelpModal } from './components/help-modal'
import { NewTabModal } from './components/new-tab-modal'
import { SessionNameModal } from './components/session-name-modal'
import { SessionPickerModal } from './components/session-picker-modal'
import { Sidebar } from './components/sidebar'
import { SnippetEditorModal } from './components/snippet-editor-modal'
import { SnippetPickerModal } from './components/snippet-picker-modal'
import { SplitLayout } from './components/split-layout'
import { StatusBar } from './components/status-bar'
import { TerminalPane } from './components/terminal-pane'
import { ThemePickerModal } from './components/theme-picker-modal'
import { theme } from './theme'

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
    return { snippetContent: '', snippetName: '' }
  }

  if (modal.activeField === 'name') {
    return {
      snippetContent: modal.contentBuffer,
      snippetName: modal.editBuffer ?? '',
    }
  }

  return {
    snippetContent: modal.editBuffer ?? '',
    snippetName: modal.contentBuffer,
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
    snippetEditorFields: { snippetName: string; snippetContent: string }
  }
) {
  switch (modal.type) {
    case 'new-tab':
    case 'split-picker':
      return (
        <NewTabModal
          selectedIndex={modal.selectedIndex}
          customCommands={options.customCommands}
          editBuffer={modal.editBuffer}
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
        />
      )
    case 'session-name':
      return (
        <SessionNameModal
          title={modal.sessionTargetId ? 'Rename session' : 'Create session'}
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
        />
      )
    case 'snippet-editor':
      return (
        <SnippetEditorModal
          activeField={modal.activeField}
          snippetName={options.snippetEditorFields.snippetName}
          snippetContent={options.snippetEditorFields.snippetContent}
          isEditing={modal.sessionTargetId !== null}
        />
      )
    case 'theme-picker':
      return (
        <ThemePickerModal selectedIndex={modal.selectedIndex} currentThemeId={options.themeId} />
      )
    case 'help':
      return <HelpModal />
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
  onPaneActivate?: (tabId: string) => void
  onSplitResize?: (tabId: string, ratio: number, axis: SplitDirection) => void
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
  onPaneActivate,
  onSeparatorDrag,
  onSeparatorDragEnd,
  onSeparatorDragStart,
  onSplitResize,
  onTerminalClick,
  onTerminalMouseEvent,
  onTerminalScrollEvent,
  terminalCols,
  terminalRows,
  themeId,
}: RootViewProps) {
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

  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  const activeTree = activeTabId ? getTreeForTab(layoutTrees, tabGroupMap, activeTabId) : null
  const createSessionFields = getCreateSessionFields(modal)
  const snippetEditorFields = getSnippetEditorFields(modal)

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={theme.background}>
      <box flexDirection="row" gap={0} padding={0} flexGrow={1}>
        <Sidebar onTabActivate={onPaneActivate} />
        {activeTree && activeTree.type === 'split' ? (
          <SplitLayout
            node={activeTree}
            tabs={tabs}
            activeTabId={activeTabId}
            focusMode={focusMode}
            contentOrigin={contentOrigin}
            mouseForwardingEnabled={mouseForwardingEnabled}
            localScrollbackEnabled={localScrollbackEnabled}
            onTerminalMouseEvent={onTerminalMouseEvent}
            onTerminalScrollEvent={onTerminalScrollEvent}
            onTerminalClick={onTerminalClick}
            onPaneActivate={onPaneActivate}
            onSplitResize={onSplitResize}
            onSeparatorDragStart={onSeparatorDragStart}
            onSeparatorDrag={onSeparatorDrag}
            onSeparatorDragEnd={onSeparatorDragEnd}
            bounds={{ cols: terminalCols, rows: terminalRows, x: 0, y: 0 }}
          />
        ) : (
          <TerminalPane
            tab={activeTab}
            focusMode={focusMode}
            contentOrigin={contentOrigin}
            mouseForwardingEnabled={mouseForwardingEnabled}
            localScrollbackEnabled={localScrollbackEnabled}
            onTerminalMouseEvent={onTerminalMouseEvent}
            onTerminalScrollEvent={onTerminalScrollEvent}
            onTerminalClick={onTerminalClick}
          />
        )}
      </box>
      <StatusBar />
      {renderModal(modal, {
        createSessionFields,
        currentSessionId,
        currentTabCount: tabs.length,
        customCommands,
        sessions,
        snippetEditorFields,
        snippets,
        themeId,
      })}
    </box>
  )
}

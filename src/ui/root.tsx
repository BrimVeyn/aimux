import type { MouseEvent } from '@opentui/core'

import type { TerminalContentOrigin } from '../input/raw-input-handler'
import type { SplitDirection } from '../state/layout-tree'
import type { ThemeId } from './themes'

import { useAppStore } from '../state/app-store'
import { findLeaf } from '../state/layout-tree'
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
  themeId,
  contentOrigin,
  mouseForwardingEnabled,
  localScrollbackEnabled,
  onTerminalMouseEvent,
  onTerminalScrollEvent,
  onTerminalClick,
  onPaneActivate,
  onSplitResize,
  onSeparatorDragStart,
  onSeparatorDrag,
  onSeparatorDragEnd,
  terminalCols,
  terminalRows,
}: RootViewProps) {
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const layoutTree = useAppStore((s) => s.layoutTree)
  const focusMode = useAppStore((s) => s.focusMode)
  const modal = useAppStore((s) => s.modal)
  const snippets = useAppStore((s) => s.snippets)
  const customCommands = useAppStore((s) => s.customCommands)
  const sessions = useAppStore((s) => s.sessions)
  const currentSessionId = useAppStore((s) => s.currentSessionId)

  const activeTab = tabs.find((tab) => tab.id === activeTabId)

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={theme.background}>
      <box flexDirection="row" gap={0} padding={0} flexGrow={1}>
        <Sidebar onTabActivate={onPaneActivate} />
        {layoutTree && layoutTree.type === 'split' && findLeaf(layoutTree, activeTabId ?? '') ? (
          <SplitLayout
            node={layoutTree}
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
            bounds={{ x: 0, y: 0, cols: terminalCols, rows: terminalRows }}
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
      {modal.type === 'new-tab' || modal.type === 'split-picker' ? (
        <NewTabModal
          selectedIndex={modal.selectedIndex}
          customCommands={customCommands}
          editBuffer={modal.editBuffer}
        />
      ) : null}
      {modal.type === 'session-picker' ? (
        <SessionPickerModal
          sessions={sessions}
          selectedIndex={modal.selectedIndex}
          currentSessionId={currentSessionId}
          currentTabCount={tabs.length}
          filter={modal.editBuffer}
        />
      ) : null}
      {modal.type === 'session-name' ? (
        <SessionNameModal
          title={modal.sessionTargetId ? 'Rename session' : 'Create session'}
          value={modal.editBuffer ?? ''}
        />
      ) : null}
      {modal.type === 'rename-tab' ? (
        <SessionNameModal title="Rename tab" value={modal.editBuffer ?? ''} />
      ) : null}
      {modal.type === 'create-session' ? (
        <CreateSessionModal
          activeField={modal.activeField}
          directoryQuery={
            modal.activeField === 'directory' ? (modal.editBuffer ?? '') : modal.nameBuffer
          }
          sessionName={modal.activeField === 'name' ? (modal.editBuffer ?? '') : modal.nameBuffer}
          results={modal.directoryResults}
          selectedIndex={modal.selectedIndex}
          pendingProjectPath={modal.pendingProjectPath}
        />
      ) : null}
      {modal.type === 'snippet-picker' ? (
        <SnippetPickerModal
          snippets={snippets}
          selectedIndex={modal.selectedIndex}
          filter={modal.editBuffer}
        />
      ) : null}
      {modal.type === 'snippet-editor' ? (
        <SnippetEditorModal
          activeField={modal.activeField}
          snippetName={
            modal.activeField === 'name' ? (modal.editBuffer ?? '') : modal.contentBuffer
          }
          snippetContent={
            modal.activeField === 'content' ? (modal.editBuffer ?? '') : modal.contentBuffer
          }
          isEditing={modal.sessionTargetId !== null}
        />
      ) : null}
      {modal.type === 'theme-picker' ? (
        <ThemePickerModal selectedIndex={modal.selectedIndex} currentThemeId={themeId} />
      ) : null}
      {modal.type === 'help' ? <HelpModal /> : null}
    </box>
  )
}

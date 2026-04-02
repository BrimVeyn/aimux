import type { MouseEvent } from '@opentui/core'

import type { TerminalContentOrigin } from '../input/raw-input-handler'
import type { SplitDirection } from '../state/layout-tree'
import type { AppState } from '../state/types'
import type { ThemeId } from './themes'

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
  state: AppState
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
  state,
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
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId)

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={theme.background}>
      <box flexDirection="row" gap={0} padding={0} flexGrow={1}>
        <Sidebar state={state} onTabActivate={onPaneActivate} />
        {state.layoutTree &&
        state.layoutTree.type === 'split' &&
        findLeaf(state.layoutTree, state.activeTabId ?? '') ? (
          <SplitLayout
            node={state.layoutTree}
            tabs={state.tabs}
            activeTabId={state.activeTabId}
            focusMode={state.focusMode}
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
            focusMode={state.focusMode}
            contentOrigin={contentOrigin}
            mouseForwardingEnabled={mouseForwardingEnabled}
            localScrollbackEnabled={localScrollbackEnabled}
            onTerminalMouseEvent={onTerminalMouseEvent}
            onTerminalScrollEvent={onTerminalScrollEvent}
            onTerminalClick={onTerminalClick}
          />
        )}
      </box>
      <StatusBar state={state} activeTab={activeTab} />
      {state.modal.type === 'new-tab' || state.modal.type === 'split-picker' ? (
        <NewTabModal
          selectedIndex={state.modal.selectedIndex}
          customCommands={state.customCommands}
          editBuffer={state.modal.editBuffer}
        />
      ) : null}
      {state.modal.type === 'session-picker' ? (
        <SessionPickerModal
          sessions={state.sessions}
          selectedIndex={state.modal.selectedIndex}
          currentSessionId={state.currentSessionId}
          currentTabCount={state.tabs.length}
          filter={state.modal.editBuffer}
        />
      ) : null}
      {state.modal.type === 'session-name' ? (
        <SessionNameModal
          title={state.modal.sessionTargetId ? 'Rename session' : 'Create session'}
          value={state.modal.editBuffer ?? ''}
        />
      ) : null}
      {state.modal.type === 'rename-tab' ? (
        <SessionNameModal title="Rename tab" value={state.modal.editBuffer ?? ''} />
      ) : null}
      {state.modal.type === 'create-session' ? (
        <CreateSessionModal
          activeField={state.modal.activeField}
          directoryQuery={
            state.modal.activeField === 'directory'
              ? (state.modal.editBuffer ?? '')
              : state.modal.nameBuffer
          }
          sessionName={
            state.modal.activeField === 'name'
              ? (state.modal.editBuffer ?? '')
              : state.modal.nameBuffer
          }
          results={state.modal.directoryResults}
          selectedIndex={state.modal.selectedIndex}
          pendingProjectPath={state.modal.pendingProjectPath}
        />
      ) : null}
      {state.modal.type === 'snippet-picker' ? (
        <SnippetPickerModal
          snippets={state.snippets}
          selectedIndex={state.modal.selectedIndex}
          filter={state.modal.editBuffer}
        />
      ) : null}
      {state.modal.type === 'snippet-editor' ? (
        <SnippetEditorModal
          activeField={state.modal.activeField}
          snippetName={
            state.modal.activeField === 'name'
              ? (state.modal.editBuffer ?? '')
              : state.modal.contentBuffer
          }
          snippetContent={
            state.modal.activeField === 'content'
              ? (state.modal.editBuffer ?? '')
              : state.modal.contentBuffer
          }
          isEditing={state.modal.sessionTargetId !== null}
        />
      ) : null}
      {state.modal.type === 'theme-picker' ? (
        <ThemePickerModal selectedIndex={state.modal.selectedIndex} currentThemeId={themeId} />
      ) : null}
      {state.modal.type === 'help' ? <HelpModal /> : null}
    </box>
  )
}

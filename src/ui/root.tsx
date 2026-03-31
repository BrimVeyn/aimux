import type { MouseEvent } from '@opentui/core'

import type { TerminalContentOrigin } from '../input/raw-input-handler'
import type { AppState } from '../state/types'
import type { ThemeId } from './themes'

import { CreateSessionModal } from './components/create-session-modal'
import { HelpModal } from './components/help-modal'
import { NewTabModal } from './components/new-tab-modal'
import { SessionNameModal } from './components/session-name-modal'
import { SessionPickerModal } from './components/session-picker-modal'
import { Sidebar } from './components/sidebar'
import { SnippetEditorModal } from './components/snippet-editor-modal'
import { SnippetPickerModal } from './components/snippet-picker-modal'
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
  onTerminalClick?: (event: MouseEvent, origin: TerminalContentOrigin) => void
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
}: RootViewProps) {
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId)

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={theme.background}>
      <box flexDirection="row" gap={1} padding={1} flexGrow={1}>
        <Sidebar state={state} />
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
      </box>
      <StatusBar state={state} activeTab={activeTab} />
      {state.modal.type === 'new-tab' ? (
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
              : state.modal.secondaryBuffer
          }
          sessionName={
            state.modal.activeField === 'name'
              ? (state.modal.editBuffer ?? '')
              : state.modal.secondaryBuffer
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
            state.modal.activeField === 'directory'
              ? (state.modal.editBuffer ?? '')
              : state.modal.secondaryBuffer
          }
          snippetContent={
            state.modal.activeField === 'name'
              ? (state.modal.editBuffer ?? '')
              : state.modal.secondaryBuffer
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

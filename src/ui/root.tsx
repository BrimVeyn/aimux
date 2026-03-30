import type { AppState } from "../state/types";

import type { TerminalContentOrigin } from "../input/raw-input-handler";
import type { MouseEvent } from "@opentui/core";
import { HelpModal } from "./components/help-modal";
import { NewTabModal } from "./components/new-tab-modal";
import { SessionNameModal } from "./components/session-name-modal";
import { SessionPickerModal } from "./components/session-picker-modal";
import { Sidebar } from "./components/sidebar";
import { StatusBar } from "./components/status-bar";
import { TerminalPane } from "./components/terminal-pane";
import { theme } from "./theme";

interface RootViewProps {
  state: AppState;
  contentOrigin: TerminalContentOrigin;
  mouseForwardingEnabled: boolean;
  localScrollbackEnabled: boolean;
  onTerminalMouseEvent: (event: MouseEvent, origin: TerminalContentOrigin) => void;
  onTerminalScrollEvent: (event: MouseEvent) => void;
}

export function RootView({
  state,
  contentOrigin,
  mouseForwardingEnabled,
  localScrollbackEnabled,
  onTerminalMouseEvent,
  onTerminalScrollEvent,
}: RootViewProps) {
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);

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
        />
      </box>
      <StatusBar state={state} activeTab={activeTab} />
      {state.modal.type === "new-tab" ? (
        <NewTabModal
          selectedIndex={state.modal.selectedIndex}
          customCommands={state.customCommands}
          editBuffer={state.modal.editBuffer}
        />
      ) : null}
      {state.modal.type === "session-picker" ? (
        <SessionPickerModal sessions={state.sessions} selectedIndex={state.modal.selectedIndex} currentSessionId={state.currentSessionId} currentTabCount={state.tabs.length} />
      ) : null}
      {state.modal.type === "session-name" ? (
        <SessionNameModal
          title={state.modal.sessionTargetId ? "Rename session" : "Create session"}
          value={state.modal.editBuffer ?? ""}
        />
      ) : null}
      {state.modal.type === "help" ? <HelpModal /> : null}
    </box>
  );
}

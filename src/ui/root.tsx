import type { AppState } from "../state/types";

import { NewTabModal } from "./components/new-tab-modal";
import { Sidebar } from "./components/sidebar";
import { StatusBar } from "./components/status-bar";
import { TerminalPane } from "./components/terminal-pane";
import { theme } from "./theme";

interface RootViewProps {
  state: AppState;
}

export function RootView({ state }: RootViewProps) {
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={theme.background}>
      <box flexDirection="row" gap={1} padding={1} flexGrow={1}>
        <Sidebar state={state} />
        <TerminalPane tab={activeTab} focusMode={state.focusMode} />
      </box>
      <StatusBar state={state} />
      {state.modal.type === "new-tab" ? <NewTabModal selectedIndex={state.modal.selectedIndex} /> : null}
    </box>
  );
}

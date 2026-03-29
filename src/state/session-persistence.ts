import type {
  AppState,
  AssistantId,
  FocusMode,
  TabSession,
  TabStatus,
  TerminalModeState,
  TerminalSnapshot,
} from "./types";

export interface PersistedTabSnapshot {
  id: string;
  assistant: AssistantId;
  title: string;
  command: string;
  status: Exclude<TabStatus, "disconnected">;
  buffer: string;
  viewport?: TerminalSnapshot;
  terminalModes: TerminalModeState;
  errorMessage?: string;
  exitCode?: number;
}

export interface WorkspaceSnapshotV1 {
  version: 1;
  savedAt: string;
  activeTabId: string | null;
  sidebar: {
    visible: boolean;
    width: number;
  };
  tabs: PersistedTabSnapshot[];
}

function getDisconnectedStatus(status: PersistedTabSnapshot["status"]): TabStatus {
  if (status === "running" || status === "starting") {
    return "disconnected";
  }

  return status;
}

export function serializeWorkspace(state: AppState): WorkspaceSnapshotV1 {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    activeTabId: state.activeTabId,
    sidebar: {
      visible: state.sidebar.visible,
      width: state.sidebar.width,
    },
    tabs: state.tabs.map((tab) => ({
      id: tab.id,
      assistant: tab.assistant,
      title: tab.title,
      command: tab.command,
      status: tab.status === "disconnected" ? "running" : tab.status,
      buffer: tab.buffer,
      viewport: tab.viewport,
      terminalModes: tab.terminalModes,
      errorMessage: tab.errorMessage,
      exitCode: tab.exitCode,
    })),
  };
}

export function restoreTabsFromWorkspace(snapshot: WorkspaceSnapshotV1 | undefined): TabSession[] {
  if (!snapshot || snapshot.version !== 1) {
    return [];
  }

  return snapshot.tabs.map((tab) => ({
    id: tab.id,
    assistant: tab.assistant,
    title: tab.title,
    status: getDisconnectedStatus(tab.status),
    activity: "idle",
    buffer: tab.buffer,
    viewport: tab.viewport,
    terminalModes: tab.terminalModes,
    command: tab.command,
    errorMessage: tab.errorMessage,
    exitCode: tab.exitCode,
  }));
}

export function restoreWorkspaceState(
  state: AppState,
  workspaceSnapshot: WorkspaceSnapshotV1 | undefined,
): Pick<AppState, "tabs" | "activeTabId" | "focusMode" | "sidebar"> {
  const tabs = restoreTabsFromWorkspace(workspaceSnapshot);
  const activeTabId =
    workspaceSnapshot?.activeTabId && tabs.some((tab) => tab.id === workspaceSnapshot.activeTabId)
      ? workspaceSnapshot.activeTabId
      : tabs[0]?.id ?? null;

  return {
    tabs,
    activeTabId,
    focusMode: "navigation" satisfies FocusMode,
    sidebar: {
      ...state.sidebar,
      visible: workspaceSnapshot?.sidebar.visible ?? state.sidebar.visible,
      width: workspaceSnapshot?.sidebar.width ?? state.sidebar.width,
    },
  };
}

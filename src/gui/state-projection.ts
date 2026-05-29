import type { AppState, TabSession } from '../state/types'

// The browser renders the full AppState, EXCEPT the heavy per-tab terminal
// payloads (`buffer`, `viewport`) which stream separately as `render` events.
// Everything else is small, plain, JSON-serializable data.
export type ProjectedTab = Omit<TabSession, 'buffer' | 'viewport'>

export interface AppStateProjection extends Omit<AppState, 'tabs'> {
  tabs: ProjectedTab[]
  themeId: string
}

function projectTab(tab: TabSession): ProjectedTab {
  return {
    activity: tab.activity,
    assistant: tab.assistant,
    command: tab.command,
    errorMessage: tab.errorMessage,
    exitCode: tab.exitCode,
    id: tab.id,
    status: tab.status,
    terminalModes: tab.terminalModes,
    title: tab.title,
    worktreeId: tab.worktreeId,
  }
}

export function projectAppState(state: AppState, themeId: string): AppStateProjection {
  return {
    ...state,
    tabs: state.tabs.map(projectTab),
    themeId,
  }
}

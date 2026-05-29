import type { ThemeMode } from '@brimveyn/aimux-config'

import type { AppState, TabSession } from '../state/types'
import type { GuiHelpEntry } from './gui-help-entries'

import { encodeDiffImages } from './encode-diff-images'

// The browser renders the full AppState, EXCEPT the heavy per-tab terminal
// payloads (`buffer`, `viewport`) which stream separately as `render` events.
// Everything else is small, plain, JSON-serializable data.
export type ProjectedTab = Omit<TabSession, 'buffer' | 'viewport'>

export interface AppStateProjection extends Omit<AppState, 'tabs'> {
  helpEntries: GuiHelpEntry[]
  tabs: ProjectedTab[]
  // `themeId` is the LIVE theme (reflects preview while the picker is open) and
  // drives the renderer's CSS. `committedThemeId` is the saved theme, used for
  // the "(current)" marker so it stays put while previewing.
  themeId: string
  committedThemeId: string
  themeMode: ThemeMode
  transparent: boolean
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

export function projectAppState(
  state: AppState,
  options: {
    committedThemeId: string
    helpEntries: GuiHelpEntry[]
    themeId: string
    themeMode: ThemeMode
    transparent: boolean
  }
): AppStateProjection {
  // Rewrite image byte fields to base64 strings so they survive JSON
  // serialization to the browser. See encode-diff-images.ts for the type
  // fudge details — DiffData's `imageBytes*` are `Uint8Array` in TS land but
  // strings on the wire; the browser consumes them via `DiffDataLite`.
  const gitMode = {
    ...state.gitMode,
    diffs: Object.fromEntries(
      Object.entries(state.gitMode.diffs).map(([k, d]) => [k, encodeDiffImages(d)])
    ),
  }
  return {
    ...state,
    committedThemeId: options.committedThemeId,
    gitMode,
    helpEntries: options.helpEntries,
    tabs: state.tabs.map(projectTab),
    themeId: options.themeId,
    themeMode: options.themeMode,
    transparent: options.transparent,
  }
}

import type { AppAction } from './actions'

import { clampBarWidth, KNOWN_WIDGET_IDS } from './bars'
import { reduceAutoCommit } from './reducers/auto-commit-state'
import { emptyGitMode, reduceGitModeState } from './reducers/git-mode-state'
import { emptyGitPanel, reduceGitPanelState } from './reducers/git-panel-state'
import { emptyModal, reduceModalState } from './reducers/modal-state'
import { reduceMultiRepoState } from './reducers/multi-repo-state'
import { reducePluginSlices } from './reducers/plugin-slices'
import { reduceProjectState } from './reducers/project-state'
import { emptySettingsUI, reduceSettingsState } from './reducers/settings-state'
import { emptyStatsUI, reduceStatsState } from './reducers/stats-state'
import { reduceTabState } from './reducers/tab-state'
import { reduceUIState } from './reducers/ui-state'
import { filterSnippets } from './selectors'
import {
  type AppState,
  type BarsState,
  EMPTY_AUTO_COMMIT_STATE,
  EMPTY_MULTI_REPO_STATE,
  type GitModeState,
  type GitPaneState,
  type ProjectRecord,
  type SnippetRecord,
} from './types'

const DEFAULT_TERMINAL_COLS = 80
const DEFAULT_TERMINAL_ROWS = 24

export interface InitialStateOverrides {
  gitMode?: Partial<GitModeState>
  gitPane?: Partial<GitPaneState>
  bars?: BarsState
  projectBarVisible?: boolean
}

const DEFAULT_GIT_PANE: GitPaneState = {
  diffCount: { enabled: true },
  diffModeRatio: 0.35,
  fileListMode: 'tree',
  path: { enabled: true },
  prefetchRadius: 5,
  treeCompaction: true,
}

export const DEFAULT_BARS: BarsState = {
  left: {
    visible: true,
    widgets: [
      { grow: 50, id: 'projects', visible: true },
      { grow: 50, id: 'git', visible: true },
      // Opt-in: reachable via the bar's right-click menu ("Show Setup"). Present
      // here so sanitizeBars places it rather than treating it as corruption.
      { grow: 50, id: 'setup', visible: false },
    ],
    width: 28,
  },
  right: { visible: false, widgets: [], width: 40 },
}

/**
 * Persisted widget ids from before the project/workspace rename. Without this
 * the old id is simply unknown, so the widget is pruned, the bar renders empty
 * and the emptied layout is written straight back to aimux.json.
 *
 * ponytail: drop with the other rename shims.
 */
const LEGACY_WIDGET_IDS: Record<string, string> = { workspaces: 'projects' }

/**
 * Drop widget ids this build cannot render (config written by a newer or
 * patched version) and normalise widths — the only place unknown ids can enter.
 */
function sanitizeBars(bars: BarsState): BarsState {
  const sanitizeBar = (bar: BarsState[keyof BarsState]): BarsState[keyof BarsState] => ({
    ...bar,
    widgets: bar.widgets
      .map((widget) => ({ ...widget, id: LEGACY_WIDGET_IDS[widget.id] ?? widget.id }))
      .filter((widget) => (KNOWN_WIDGET_IDS as readonly string[]).includes(widget.id))
      .map((widget) => ({ ...widget, grow: Math.max(1, Math.round(widget.grow)) })),
    width: clampBarWidth(bar.width),
  })
  const sanitized: BarsState = { left: sanitizeBar(bars.left), right: sanitizeBar(bars.right) }

  // A widget can only ever be moved between bars or hidden, never deleted, so
  // one that is in neither bar means the persisted layout was corrupted —
  // which is exactly what the pre-rename `workspaces` id did to older files
  // before LEGACY_WIDGET_IDS existed. Put it back where it ships by default,
  // otherwise the bar renders empty forever and re-saves that emptiness.
  for (const side of ['left', 'right'] as const) {
    for (const fallback of DEFAULT_BARS[side].widgets) {
      const present =
        sanitized.left.widgets.some((w) => w.id === fallback.id) ||
        sanitized.right.widgets.some((w) => w.id === fallback.id)
      if (!present) {
        sanitized[side] = { ...sanitized[side], widgets: [...sanitized[side].widgets, fallback] }
      }
    }
  }
  return sanitized
}

export function createInitialState(
  customCommands: Record<string, string> = {},
  projects: ProjectRecord[] = [],
  snippets: SnippetRecord[] = [],
  showProjectPicker = false,
  overrides: InitialStateOverrides = {}
): AppState {
  return {
    activePluginView: null,
    activeTabId: null,
    autoCommit: EMPTY_AUTO_COMMIT_STATE,
    bars: sanitizeBars(overrides.bars ?? DEFAULT_BARS),
    currentProjectId: null,
    customCommands,
    focusMode: showProjectPicker ? 'command-edit' : 'navigation',
    gitMode: { ...emptyGitMode(), ...overrides.gitMode },
    gitPane: { ...DEFAULT_GIT_PANE, ...overrides.gitPane },
    gitPanel: emptyGitPanel(),
    lastActiveTabByWorkspace: {},
    layout: {
      terminalCols: DEFAULT_TERMINAL_COLS,
      terminalRows: DEFAULT_TERMINAL_ROWS,
    },
    layoutTrees: {},
    modal: showProjectPicker
      ? {
          cursorPos: 0,
          editBuffer: '',
          projectTargetId: null,
          selectedIndex: 0,
          type: 'project-picker',
        }
      : emptyModal(),
    multiRepo: EMPTY_MULTI_REPO_STATE,
    pendingChords: null,
    pluginRegistryVersion: 0,
    plugins: {},
    projectBar: {
      visible: overrides.projectBarVisible ?? true,
    },
    projects,
    projectStatuses: {},
    settings: emptySettingsUI(),
    snippets,
    stats: emptyStatsUI(),
    tabGroupMap: {},
    tabs: [],
    workspaceActivity: {},
    workspaceDivergence: {},
  }
}

export function appReducer(state: AppState, action: AppAction): AppState {
  const projectState = reduceProjectState(state, action)
  if (projectState) return projectState

  const tabState = reduceTabState(state, action)
  if (tabState) return tabState

  const modalState = reduceModalState(state, action)
  if (modalState) return modalState

  const uiState = reduceUIState(state, action)
  if (uiState) return uiState

  const gitPanelState = reduceGitPanelState(state, action)
  if (gitPanelState) return gitPanelState

  const gitModeState = reduceGitModeState(state, action)
  if (gitModeState) return gitModeState

  const autoCommitState = reduceAutoCommit(state, action)
  if (autoCommitState) return autoCommitState

  const multiRepoState = reduceMultiRepoState(state, action)
  if (multiRepoState) return multiRepoState

  const settingsState = reduceSettingsState(state, action)
  if (settingsState) return settingsState

  const statsState = reduceStatsState(state, action)
  if (statsState) return statsState

  // Last: by now every built-in reducer has declined the action, so a plugin
  // can never shadow a core one by registering a slice with a colliding name.
  const pluginState = reducePluginSlices(state, action)
  if (pluginState) return pluginState

  switch (action.type) {
    case 'set-snippets':
      return { ...state, snippets: action.snippets }
    case 'set-custom-commands':
      return { ...state, customCommands: action.customCommands }
    case 'delete-snippet': {
      const newSnippets = state.snippets.filter((s) => s.id !== action.snippetId)
      const filteredNew = filterSnippets(newSnippets, state.modal.editBuffer)
      const maxIndex = Math.max(0, filteredNew.length - 1)
      return {
        ...state,
        modal: {
          ...state.modal,
          selectedIndex: Math.min(state.modal.selectedIndex, maxIndex),
        },
        snippets: newSnippets,
      }
    }
    default:
      return state
  }
}

import type { WorktreeTemplate } from '../config'

import { clampBarWidth, KNOWN_WIDGET_IDS } from './bars'
import { reduceAutoCommit } from './reducers/auto-commit-state'
import { emptyGitMode, reduceGitModeState } from './reducers/git-mode-state'
import { emptyGitPanel, reduceGitPanelState } from './reducers/git-panel-state'
import { emptyModal, reduceModalState } from './reducers/modal-state'
import { reduceMultiRepoState } from './reducers/multi-repo-state'
import { reduceSessionState } from './reducers/session-state'
import { reduceTabState } from './reducers/tab-state'
import { reduceUIState } from './reducers/ui-state'
import { filterSnippets } from './selectors'
import {
  type AppAction,
  type AppState,
  type BarsState,
  EMPTY_AUTO_COMMIT_STATE,
  EMPTY_MULTI_REPO_STATE,
  type GitModeState,
  type GitPaneState,
  type SessionRecord,
  type SnippetRecord,
} from './types'

const DEFAULT_TERMINAL_COLS = 80
const DEFAULT_TERMINAL_ROWS = 24

export interface InitialStateOverrides {
  gitMode?: Partial<GitModeState>
  gitPane?: Partial<GitPaneState>
  bars?: BarsState
  sessionBarVisible?: boolean
  worktreeTemplates?: WorktreeTemplate[]
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
      { grow: 50, id: 'workspaces', visible: true },
      { grow: 50, id: 'git', visible: true },
    ],
    width: 28,
  },
  right: { visible: false, widgets: [], width: 40 },
}

/**
 * Drop widget ids this build cannot render (config written by a newer or
 * patched version) and normalise widths — the only place unknown ids can enter.
 */
function sanitizeBars(bars: BarsState): BarsState {
  const sanitizeBar = (bar: BarsState[keyof BarsState]): BarsState[keyof BarsState] => ({
    ...bar,
    widgets: bar.widgets
      .filter((widget) => (KNOWN_WIDGET_IDS as readonly string[]).includes(widget.id))
      .map((widget) => ({ ...widget, grow: Math.max(1, Math.round(widget.grow)) })),
    width: clampBarWidth(bar.width),
  })
  return { left: sanitizeBar(bars.left), right: sanitizeBar(bars.right) }
}

export function createInitialState(
  customCommands: Record<string, string> = {},
  sessions: SessionRecord[] = [],
  snippets: SnippetRecord[] = [],
  showSessionPicker = false,
  overrides: InitialStateOverrides = {}
): AppState {
  return {
    activeTabId: null,
    autoCommit: EMPTY_AUTO_COMMIT_STATE,
    bars: sanitizeBars(overrides.bars ?? DEFAULT_BARS),
    currentSessionId: null,
    customCommands,
    focusMode: showSessionPicker ? 'command-edit' : 'navigation',
    gitMode: { ...emptyGitMode(), ...overrides.gitMode },
    gitPane: { ...DEFAULT_GIT_PANE, ...overrides.gitPane },
    gitPanel: emptyGitPanel(),
    lastActiveTabByWorktree: {},
    layout: {
      terminalCols: DEFAULT_TERMINAL_COLS,
      terminalRows: DEFAULT_TERMINAL_ROWS,
    },
    layoutTrees: {},
    modal: showSessionPicker
      ? {
          cursorPos: 0,
          editBuffer: '',
          selectedIndex: 0,
          sessionTargetId: null,
          type: 'session-picker',
        }
      : emptyModal(),
    multiRepo: EMPTY_MULTI_REPO_STATE,
    pendingChords: null,
    sessionBar: {
      visible: overrides.sessionBarVisible ?? true,
    },
    sessions,
    sessionStatuses: {},
    snippets,
    tabGroupMap: {},
    tabs: [],
    worktreeDivergence: {},
    worktreeTemplates: overrides.worktreeTemplates ?? [],
  }
}

export function appReducer(state: AppState, action: AppAction): AppState {
  const sessionState = reduceSessionState(state, action)
  if (sessionState) return sessionState

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

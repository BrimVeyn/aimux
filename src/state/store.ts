import { reduceAutoCommit } from './reducers/auto-commit-state'
import { emptyGitMode, reduceGitModeState } from './reducers/git-mode-state'
import { emptyGitPanel, reduceGitPanelState } from './reducers/git-panel-state'
import { emptyModal, reduceModalState } from './reducers/modal-state'
import { reduceSessionState } from './reducers/session-state'
import { reduceTabState } from './reducers/tab-state'
import { reduceUIState } from './reducers/ui-state'
import { filterSnippets } from './selectors'
import {
  type AppAction,
  type AppState,
  EMPTY_AUTO_COMMIT_STATE,
  type GitModeState,
  type GitPaneMode,
  type GitPanePosition,
  type GitPaneState,
  type SessionBarPosition,
  type SessionRecord,
  type SnippetRecord,
} from './types'

const DEFAULT_SIDEBAR_WIDTH = 28
const DEFAULT_SIDEBAR_MIN_WIDTH = 18
const DEFAULT_SIDEBAR_MAX_WIDTH = 42
const DEFAULT_TERMINAL_COLS = 80
const DEFAULT_TERMINAL_ROWS = 24

export interface InitialStateOverrides {
  gitMode?: Partial<GitModeState>
  gitPane?: Partial<GitPaneState>
  sessionBarVisible?: boolean
  sessionBarPosition?: SessionBarPosition
}

const DEFAULT_GIT_PANE: GitPaneState = {
  diffCount: { enabled: true },
  diffModeRatio: 0.35,
  fileListMode: 'tree',
  mode: 'embedded',
  path: { enabled: true },
  position: 'bottom',
  prefetchRadius: 5,
  ratio: 0.5,
  treeCompaction: true,
  visible: true,
}

function resolveGitPanePosition(mode: GitPaneMode, position: GitPanePosition): GitPanePosition {
  if (mode === 'embedded') {
    return position === 'top' || position === 'bottom' ? position : 'bottom'
  }
  return position === 'left' || position === 'right' ? position : 'left'
}

export function createInitialState(
  customCommands: Record<string, string> = {},
  sessions: SessionRecord[] = [],
  snippets: SnippetRecord[] = [],
  showSessionPicker = false,
  overrides: InitialStateOverrides = {}
): AppState {
  const gitPaneMode = overrides.gitPane?.mode ?? DEFAULT_GIT_PANE.mode
  const gitPanePosition = resolveGitPanePosition(
    gitPaneMode,
    overrides.gitPane?.position ?? DEFAULT_GIT_PANE.position
  )
  return {
    activeTabId: null,
    autoCommit: EMPTY_AUTO_COMMIT_STATE,
    currentSessionId: null,
    customCommands,
    focusMode: showSessionPicker ? 'command-edit' : 'navigation',
    gitMode: { ...emptyGitMode(), ...overrides.gitMode },
    gitPane: {
      ...DEFAULT_GIT_PANE,
      ...overrides.gitPane,
      mode: gitPaneMode,
      position: gitPanePosition,
    },
    gitPanel: emptyGitPanel(),
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
    pendingChords: null,
    sessionBar: {
      position: overrides.sessionBarPosition ?? 'top',
      visible: overrides.sessionBarVisible ?? true,
    },
    sessions,
    sessionStatuses: {},
    sidebar: {
      maxWidth: DEFAULT_SIDEBAR_MAX_WIDTH,
      minWidth: DEFAULT_SIDEBAR_MIN_WIDTH,
      visible: true,
      width: DEFAULT_SIDEBAR_WIDTH,
    },
    snippets,
    tabGroupMap: {},
    tabs: [],
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

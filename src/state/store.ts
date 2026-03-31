import { basename } from 'node:path'

import { ASSISTANT_OPTIONS } from '../pty/command-registry'
import { THEME_IDS } from '../ui/themes'

const THEME_COUNT = THEME_IDS.length
import type { AppAction, AppState, SessionRecord, SnippetRecord, TabSession } from './types'

import { restoreWorkspaceState } from './session-persistence'

const MAX_BUFFER_LENGTH = 50_000

function clampBuffer(buffer: string): string {
  return buffer.length <= MAX_BUFFER_LENGTH
    ? buffer
    : buffer.slice(buffer.length - MAX_BUFFER_LENGTH)
}

function updateTab(
  tabs: TabSession[],
  tabId: string,
  updater: (tab: TabSession) => TabSession
): TabSession[] {
  return tabs.map((tab) => (tab.id === tabId ? updater(tab) : tab))
}

function getActiveIndex(state: AppState): number {
  if (!state.activeTabId) {
    return -1
  }

  return state.tabs.findIndex((tab) => tab.id === state.activeTabId)
}

function closeTabAtIndex(state: AppState, indexToClose: number): AppState {
  if (indexToClose < 0 || indexToClose >= state.tabs.length) {
    return state
  }

  const closingTabId = state.tabs[indexToClose]?.id
  const tabs = state.tabs.filter((_, index) => index !== indexToClose)
  const nextActiveTab =
    state.activeTabId === closingTabId
      ? (tabs[indexToClose] ?? tabs[indexToClose - 1] ?? null)
      : (tabs.find((tab) => tab.id === state.activeTabId) ?? null)

  return {
    ...state,
    tabs,
    activeTabId: nextActiveTab?.id ?? null,
    focusMode: tabs.length === 0 ? 'navigation' : state.focusMode,
  }
}

export function filterSessions(sessions: SessionRecord[], filter: string | null): SessionRecord[] {
  if (!filter) return sessions
  const lower = filter.toLowerCase()
  return sessions.filter(
    (s) =>
      s.name.toLowerCase().includes(lower) ||
      (s.projectPath && s.projectPath.toLowerCase().includes(lower))
  )
}

export function filterSnippets(snippets: SnippetRecord[], filter: string | null): SnippetRecord[] {
  if (!filter) return snippets
  const lower = filter.toLowerCase()
  return snippets.filter(
    (s) => s.name.toLowerCase().includes(lower) || s.content.toLowerCase().includes(lower)
  )
}

function emptyModal() {
  return {
    type: null,
    selectedIndex: 0,
    editBuffer: null,
    sessionTargetId: null,
  } as const
}

export function createInitialState(
  customCommands: Record<string, string> = {},
  sessions: SessionRecord[] = [],
  snippets: SnippetRecord[] = [],
  showSessionPicker = false
): AppState {
  return {
    tabs: [],
    activeTabId: null,
    sessions,
    currentSessionId: null,
    snippets,
    focusMode: showSessionPicker ? 'modal' : 'navigation',
    sidebar: {
      visible: true,
      width: 28,
      minWidth: 18,
      maxWidth: 42,
    },
    modal: showSessionPicker
      ? { type: 'session-picker', selectedIndex: 0, editBuffer: null, sessionTargetId: null }
      : emptyModal(),
    layout: {
      terminalCols: 80,
      terminalRows: 24,
    },
    customCommands,
  }
}

export function getActiveTab(state: AppState): TabSession | undefined {
  return state.activeTabId ? state.tabs.find((tab) => tab.id === state.activeTabId) : undefined
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'open-new-tab-modal':
      return {
        ...state,
        focusMode: 'modal',
        modal: { type: 'new-tab', selectedIndex: 0, editBuffer: null, sessionTargetId: null },
      }
    case 'open-help-modal':
      return {
        ...state,
        focusMode: 'modal',
        modal: { type: 'help', selectedIndex: 0, editBuffer: null, sessionTargetId: null },
      }
    case 'open-session-picker':
      return {
        ...state,
        focusMode: 'modal',
        modal: {
          type: 'session-picker',
          selectedIndex: 0,
          editBuffer: null,
          sessionTargetId: null,
        },
      }
    case 'open-session-name-modal':
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          type: 'session-name',
          selectedIndex: 0,
          editBuffer: action.initialName ?? '',
          sessionTargetId: action.sessionTargetId ?? null,
        },
      }
    case 'open-create-session-modal':
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          type: 'create-session',
          selectedIndex: 0,
          editBuffer: '',
          sessionTargetId: null,
          directoryResults: [],
          pendingProjectPath: null,
          activeField: 'directory',
          secondaryBuffer: '',
        },
      }
    case 'set-directory-results': {
      if (state.modal.type !== 'create-session') {
        return state
      }
      return {
        ...state,
        modal: {
          ...state.modal,
          directoryResults: action.results,
          selectedIndex: 0,
        },
      }
    }
    case 'open-snippet-picker':
      return {
        ...state,
        focusMode: 'modal',
        modal: {
          type: 'snippet-picker',
          selectedIndex: 0,
          editBuffer: null,
          sessionTargetId: null,
        },
      }
    case 'open-snippet-editor': {
      const snippet = action.snippetId
        ? state.snippets.find((s) => s.id === action.snippetId)
        : undefined
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          type: 'snippet-editor',
          selectedIndex: 0,
          editBuffer: snippet?.name ?? '',
          sessionTargetId: snippet?.id ?? null,
          activeField: 'directory',
          secondaryBuffer: snippet?.content ?? '',
        },
      }
    }
    case 'set-snippets':
      return { ...state, snippets: action.snippets }
    case 'delete-snippet': {
      const newSnippets = state.snippets.filter((s) => s.id !== action.snippetId)
      const filteredNew = filterSnippets(newSnippets, state.modal.editBuffer)
      const maxIndex = Math.max(0, filteredNew.length - 1)
      return {
        ...state,
        snippets: newSnippets,
        modal: {
          ...state.modal,
          selectedIndex: Math.min(state.modal.selectedIndex, maxIndex),
        },
      }
    }
    case 'open-theme-picker':
      return {
        ...state,
        focusMode: 'modal',
        modal: { type: 'theme-picker', selectedIndex: 0, editBuffer: null, sessionTargetId: null },
      }
    case 'begin-snippet-filter': {
      if (state.modal.type !== 'snippet-picker') {
        return state
      }
      return {
        ...state,
        focusMode: 'command-edit',
        modal: { ...state.modal, editBuffer: state.modal.editBuffer ?? '' },
      }
    }
    case 'close-modal':
      return { ...state, focusMode: 'navigation', modal: emptyModal() }
    case 'move-modal-selection': {
      if (
        state.modal.type !== 'new-tab' &&
        state.modal.type !== 'session-picker' &&
        state.modal.type !== 'snippet-picker' &&
        state.modal.type !== 'theme-picker' &&
        state.modal.type !== 'create-session'
      ) {
        return state
      }
      if (state.modal.type === 'create-session' && state.modal.activeField !== 'directory') {
        return state
      }
      let optionCount: number
      if (state.modal.type === 'new-tab') {
        optionCount = ASSISTANT_OPTIONS.length
      } else if (state.modal.type === 'create-session') {
        optionCount = state.modal.directoryResults.length
      } else if (state.modal.type === 'snippet-picker') {
        const filtered = filterSnippets(state.snippets, state.modal.editBuffer)
        optionCount = filtered.length
      } else if (state.modal.type === 'theme-picker') {
        optionCount = THEME_COUNT
      } else {
        const filtered = filterSessions(state.sessions, state.modal.editBuffer)
        optionCount = Math.max(1, filtered.length + 1)
      }
      if (optionCount === 0) {
        return state
      }
      return {
        ...state,
        modal: {
          ...state.modal,
          selectedIndex: (state.modal.selectedIndex + action.delta + optionCount) % optionCount,
        },
      }
    }
    case 'add-tab':
      return {
        ...state,
        tabs: [...state.tabs, { ...action.tab, activity: action.tab.activity ?? 'idle' }],
        activeTabId: action.tab.id,
        focusMode: 'navigation',
        modal: emptyModal(),
      }
    case 'hydrate-workspace': {
      const hydratedActiveTabId =
        action.activeTabId && action.tabs.some((tab) => tab.id === action.activeTabId)
          ? action.activeTabId
          : (action.tabs[0]?.id ?? null)
      return {
        ...state,
        tabs: action.tabs,
        activeTabId: hydratedActiveTabId,
        focusMode: 'navigation',
      }
    }
    case 'load-session': {
      const snapshot =
        action.workspaceSnapshot ??
        state.sessions.find((entry) => entry.id === action.sessionId)?.workspaceSnapshot
      return {
        ...state,
        ...restoreWorkspaceState(state, snapshot),
        currentSessionId: action.sessionId,
        sessions: state.sessions.map((entry) =>
          entry.id === action.sessionId
            ? {
                ...entry,
                lastOpenedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }
            : entry
        ),
        focusMode: 'navigation',
        modal: emptyModal(),
      }
    }
    case 'set-sessions':
      return { ...state, sessions: action.sessions }
    case 'create-session-record':
      return {
        ...state,
        sessions: [...state.sessions, action.session],
        currentSessionId: action.session.id,
        focusMode: 'navigation',
        modal: emptyModal(),
      }
    case 'rename-session-record':
      return {
        ...state,
        sessions: state.sessions.map((session) =>
          session.id === action.sessionId
            ? { ...session, name: action.name, updatedAt: new Date().toISOString() }
            : session
        ),
        focusMode: 'modal',
        modal: {
          type: 'session-picker',
          selectedIndex: state.modal.selectedIndex,
          editBuffer: null,
          sessionTargetId: null,
        },
      }
    case 'delete-session-record': {
      const newSessions = state.sessions.filter((session) => session.id !== action.sessionId)
      const filteredNew = filterSessions(newSessions, state.modal.editBuffer)
      const maxIndex = filteredNew.length // index of "Create new session" option
      const clampedIndex = Math.min(state.modal.selectedIndex, maxIndex)
      return {
        ...state,
        sessions: newSessions,
        currentSessionId:
          action.sessionId === state.currentSessionId ? null : state.currentSessionId,
        tabs: action.sessionId === state.currentSessionId ? [] : state.tabs,
        activeTabId: action.sessionId === state.currentSessionId ? null : state.activeTabId,
        focusMode: 'modal',
        modal: {
          type: 'session-picker',
          selectedIndex: clampedIndex,
          editBuffer: null,
          sessionTargetId: null,
        },
      }
    }
    case 'close-tab':
      return closeTabAtIndex(
        state,
        state.tabs.findIndex((tab) => tab.id === action.tabId)
      )
    case 'close-active-tab':
      return closeTabAtIndex(state, getActiveIndex(state))
    case 'set-active-tab':
      return { ...state, activeTabId: action.tabId }
    case 'move-active-tab': {
      if (state.tabs.length === 0) {
        return state
      }
      const currentIndex = state.tabs.findIndex((tab) => tab.id === state.activeTabId)
      const safeIndex = currentIndex === -1 ? 0 : currentIndex
      const nextIndex = (safeIndex + action.delta + state.tabs.length) % state.tabs.length
      const nextTabId = state.tabs[nextIndex]?.id
      return !nextTabId || nextTabId === state.activeTabId
        ? state
        : { ...state, activeTabId: nextTabId }
    }
    case 'reorder-active-tab': {
      const activeIndex = getActiveIndex(state)
      if (activeIndex === -1) {
        return state
      }
      const nextIndex = activeIndex + action.delta
      if (nextIndex < 0 || nextIndex >= state.tabs.length) {
        return state
      }
      const tabs = [...state.tabs]
      const current = tabs[activeIndex]
      const target = tabs[nextIndex]
      if (!current || !target) {
        return state
      }
      tabs[activeIndex] = target
      tabs[nextIndex] = current
      return { ...state, tabs }
    }
    case 'reset-tab-session':
      return {
        ...state,
        activeTabId: action.tabId,
        focusMode: 'navigation',
        tabs: updateTab(state.tabs, action.tabId, (tab) => ({
          ...tab,
          status: 'starting',
          activity: 'idle',
          buffer: '',
          viewport: undefined,
          errorMessage: undefined,
          exitCode: undefined,
          terminalModes: {
            mouseTrackingMode: 'none',
            sendFocusMode: false,
            alternateScrollMode: false,
            isAlternateBuffer: false,
            bracketedPasteMode: false,
          },
        })),
      }
    case 'toggle-sidebar':
      return { ...state, sidebar: { ...state.sidebar, visible: !state.sidebar.visible } }
    case 'resize-sidebar': {
      const width = Math.min(
        state.sidebar.maxWidth,
        Math.max(state.sidebar.minWidth, state.sidebar.width + action.delta)
      )
      return { ...state, sidebar: { ...state.sidebar, width } }
    }
    case 'set-focus-mode':
      return { ...state, focusMode: action.focusMode }
    case 'append-tab-buffer':
      return {
        ...state,
        tabs: updateTab(state.tabs, action.tabId, (tab) => ({
          ...tab,
          buffer: clampBuffer(`${tab.buffer}${action.chunk}`),
          status: tab.status === 'starting' ? 'running' : tab.status,
        })),
      }
    case 'replace-tab-viewport':
      return {
        ...state,
        tabs: updateTab(state.tabs, action.tabId, (tab) => ({
          ...tab,
          viewport: action.viewport,
          terminalModes: action.terminalModes,
          status: tab.status === 'starting' ? 'running' : tab.status,
        })),
      }
    case 'set-tab-activity':
      return {
        ...state,
        tabs: updateTab(state.tabs, action.tabId, (tab) => ({ ...tab, activity: action.activity })),
      }
    case 'set-tab-status':
      return {
        ...state,
        tabs: updateTab(state.tabs, action.tabId, (tab) => ({
          ...tab,
          status: action.status,
          exitCode: action.exitCode,
          activity: action.status === 'running' ? tab.activity : undefined,
        })),
      }
    case 'set-tab-error':
      return {
        ...state,
        tabs: updateTab(state.tabs, action.tabId, (tab) => ({
          ...tab,
          status: 'error',
          activity: undefined,
          errorMessage: action.message,
          buffer: clampBuffer(`${tab.buffer}${action.message}\n`),
        })),
      }
    case 'set-terminal-size':
      return { ...state, layout: { terminalCols: action.cols, terminalRows: action.rows } }
    case 'begin-command-edit': {
      if (state.modal.type !== 'new-tab' && state.modal.type !== 'session-name') {
        return state
      }
      if (state.modal.type === 'session-name') {
        return { ...state, focusMode: 'command-edit' }
      }
      const option = ASSISTANT_OPTIONS[state.modal.selectedIndex]
      const assistantId = option?.id
      const currentCmd = (assistantId && state.customCommands[assistantId]) ?? option?.command ?? ''
      return {
        ...state,
        focusMode: 'command-edit',
        modal: { ...state.modal, editBuffer: currentCmd },
      }
    }
    case 'update-command-edit': {
      if (state.modal.editBuffer === null) {
        return state
      }
      const buf =
        action.char === '\b'
          ? state.modal.editBuffer.slice(0, -1)
          : state.modal.editBuffer + action.char
      const resetIndex =
        state.modal.type === 'session-picker' || state.modal.type === 'snippet-picker'
          ? 0
          : state.modal.selectedIndex
      return { ...state, modal: { ...state.modal, editBuffer: buf, selectedIndex: resetIndex } }
    }
    case 'commit-command-edit': {
      if (state.modal.editBuffer === null) {
        return state
      }
      if (state.modal.type === 'create-session') {
        return state
      }
      if (state.modal.type === 'snippet-editor') {
        return state
      }
      if (state.modal.type === 'rename-tab') {
        return state
      }
      if (state.modal.type === 'session-name') {
        return state
      }
      if (state.modal.type === 'session-picker' || state.modal.type === 'snippet-picker') {
        return {
          ...state,
          focusMode: 'modal',
          modal: { ...state.modal, selectedIndex: 0 },
        }
      }
      if (state.modal.type !== 'new-tab') {
        return state
      }
      const option = ASSISTANT_OPTIONS[state.modal.selectedIndex]
      const assistantId = option?.id
      if (!assistantId) {
        return { ...state, focusMode: 'modal', modal: { ...state.modal, editBuffer: null } }
      }
      const trimmed = state.modal.editBuffer.trim()
      const newCustomCommands = { ...state.customCommands }
      if (trimmed) {
        newCustomCommands[assistantId] = trimmed
      } else {
        delete newCustomCommands[assistantId]
      }
      return {
        ...state,
        focusMode: 'modal',
        customCommands: newCustomCommands,
        modal: { ...state.modal, editBuffer: null },
      }
    }
    case 'cancel-command-edit': {
      if (state.modal.type === 'create-session' || state.modal.type === 'snippet-editor') {
        return { ...state, focusMode: 'navigation', modal: emptyModal() }
      }
      if (state.modal.type === 'session-picker' || state.modal.type === 'snippet-picker') {
        return {
          ...state,
          focusMode: 'modal',
          modal: { ...state.modal, editBuffer: null, selectedIndex: 0 },
        }
      }
      return { ...state, focusMode: 'modal', modal: { ...state.modal, editBuffer: null } }
    }
    case 'switch-create-session-field': {
      if (state.modal.type !== 'create-session' && state.modal.type !== 'snippet-editor') {
        return state
      }
      const nextField = state.modal.activeField === 'directory' ? 'name' : 'directory'
      return {
        ...state,
        modal: {
          ...state.modal,
          activeField: nextField,
          editBuffer: state.modal.secondaryBuffer,
          secondaryBuffer: state.modal.editBuffer ?? '',
        },
      }
    }
    case 'select-directory': {
      if (state.modal.type !== 'create-session') {
        return state
      }
      const selected = state.modal.directoryResults[state.modal.selectedIndex]
      if (!selected) {
        return state
      }
      const nameBuffer =
        state.modal.activeField === 'directory'
          ? state.modal.secondaryBuffer
          : (state.modal.editBuffer ?? '')
      const autoName = nameBuffer || basename(selected.path)
      return {
        ...state,
        modal: {
          ...state.modal,
          pendingProjectPath: selected.path,
          activeField: 'name',
          editBuffer: autoName,
          secondaryBuffer:
            state.modal.activeField === 'directory'
              ? (state.modal.editBuffer ?? '')
              : state.modal.secondaryBuffer,
        },
      }
    }
    case 'begin-session-filter': {
      if (state.modal.type !== 'session-picker') {
        return state
      }
      return {
        ...state,
        focusMode: 'command-edit',
        modal: { ...state.modal, editBuffer: state.modal.editBuffer ?? '' },
      }
    }
    case 'open-rename-tab-modal': {
      const activeTab = state.activeTabId
        ? state.tabs.find((tab) => tab.id === state.activeTabId)
        : undefined
      if (!activeTab) {
        return state
      }
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          type: 'rename-tab',
          selectedIndex: 0,
          editBuffer: activeTab.title,
          sessionTargetId: activeTab.id,
        },
      }
    }
    case 'rename-tab':
      return {
        ...state,
        tabs: updateTab(state.tabs, action.tabId, (tab) => ({ ...tab, title: action.title })),
      }
    default:
      return state
  }
}

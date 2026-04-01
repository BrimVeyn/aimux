import { basename } from 'node:path'

import { ASSISTANT_OPTIONS, getAllAssistantOptions } from '../pty/command-registry'
import { THEME_IDS } from '../ui/themes'

const THEME_COUNT = THEME_IDS.length
import type { AppAction, AppState, SessionRecord, SnippetRecord, TabSession } from './types'

import { reduceSessionState } from './reducers/session-state'
import { reduceTabState } from './reducers/tab-state'
import { filterSessions, filterSnippets, getActiveTab } from './selectors'

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

export function appReducer(state: AppState, action: AppAction): AppState {
  const sessionState = reduceSessionState(state, action)
  if (sessionState) {
    return sessionState
  }

  const tabState = reduceTabState(state, action)
  if (tabState) {
    return tabState
  }

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
        optionCount = getAllAssistantOptions(state.customCommands).length
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
    case 'set-terminal-size':
      return { ...state, layout: { terminalCols: action.cols, terminalRows: action.rows } }
    case 'begin-command-edit': {
      if (state.modal.type !== 'new-tab' && state.modal.type !== 'session-name') {
        return state
      }
      if (state.modal.type === 'session-name') {
        return { ...state, focusMode: 'command-edit' }
      }
      const allOptions = getAllAssistantOptions(state.customCommands)
      const option = allOptions[state.modal.selectedIndex]
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
      const allOpts = getAllAssistantOptions(state.customCommands)
      const option = allOpts[state.modal.selectedIndex]
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
    default:
      return state
  }
}

import { basename } from 'node:path'

import type { AppAction, AppState } from '../types'

import { getAllAssistantOptions } from '../../pty/command-registry'
import { THEME_IDS } from '../../ui/themes'
import { filterSessions, filterSnippets } from '../selectors'

const THEME_COUNT = THEME_IDS.length

function emptyModal() {
  return {
    type: null,
    selectedIndex: 0,
    editBuffer: null,
    sessionTargetId: null,
  } as const
}

export { emptyModal }

export function reduceModalState(state: AppState, action: AppAction): AppState | null {
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
    case 'open-split-picker':
      return {
        ...state,
        focusMode: 'modal',
        modal: {
          type: 'split-picker',
          selectedIndex: 0,
          editBuffer: null,
          sessionTargetId: null,
          splitDirection: action.direction,
        },
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
          nameBuffer: '',
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
          activeField: 'name',
          contentBuffer: snippet?.content ?? '',
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
        state.modal.type !== 'create-session' &&
        state.modal.type !== 'split-picker'
      ) {
        return state
      }
      if (state.modal.type === 'create-session' && state.modal.activeField !== 'directory') {
        return state
      }
      let optionCount: number
      if (state.modal.type === 'new-tab' || state.modal.type === 'split-picker') {
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
      if (state.modal.type === 'create-session') {
        const nextField = state.modal.activeField === 'directory' ? 'name' : 'directory'
        return {
          ...state,
          modal: {
            ...state.modal,
            activeField: nextField,
            editBuffer: state.modal.nameBuffer,
            nameBuffer: state.modal.editBuffer ?? '',
          },
        }
      }
      if (state.modal.type === 'snippet-editor') {
        const nextField = state.modal.activeField === 'name' ? 'content' : 'name'
        return {
          ...state,
          modal: {
            ...state.modal,
            activeField: nextField,
            editBuffer: state.modal.contentBuffer,
            contentBuffer: state.modal.editBuffer ?? '',
          },
        }
      }
      return state
    }
    case 'select-directory': {
      if (state.modal.type !== 'create-session') {
        return state
      }
      const selected = state.modal.directoryResults[state.modal.selectedIndex]
      if (!selected) {
        return state
      }
      const nameValue =
        state.modal.activeField === 'directory'
          ? state.modal.nameBuffer
          : (state.modal.editBuffer ?? '')
      const autoName = nameValue || basename(selected.path)
      return {
        ...state,
        modal: {
          ...state.modal,
          pendingProjectPath: selected.path,
          activeField: 'name',
          editBuffer: autoName,
          nameBuffer:
            state.modal.activeField === 'directory'
              ? (state.modal.editBuffer ?? '')
              : state.modal.nameBuffer,
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
      return null
  }
}

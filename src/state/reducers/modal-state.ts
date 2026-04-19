import { basename } from 'node:path'

import type { AppAction, AppState } from '../types'

import { collectHelpEntries } from '../../input/keymap/help-entries'
import { getActiveKeymap } from '../../input/keymap/keymap-ref'
import { getAllAssistantOptions } from '../../pty/command-registry'
import { filterThemeIds } from '../../ui/filter-themes'
import { filterAssistants, filterSessions, filterSnippets } from '../selectors'

function emptyModal() {
  return {
    cursorPos: 0,
    editBuffer: null,
    selectedIndex: 0,
    sessionTargetId: null,
    type: null,
  } as const
}

export { emptyModal }

function clampCursor(value: number, max: number): number {
  return Math.max(0, Math.min(max, value))
}

export function reduceModalState(state: AppState, action: AppAction): AppState | null {
  switch (action.type) {
    case 'open-new-tab-modal':
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          cursorPos: 0,
          editBuffer: '',
          editingCommand: null,
          selectedIndex: 0,
          sessionTargetId: null,
          type: 'new-tab',
        },
      }
    case 'open-edit-custom-command': {
      if (state.modal.type !== 'new-tab') return state
      const current = state.customCommands[action.assistantId] ?? ''
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          ...state.modal,
          cursorPos: current.length,
          editBuffer: current,
          editingCommand: action.assistantId,
        },
      }
    }
    case 'open-help-modal': {
      const keymap = getActiveKeymap()
      const scope = action.scope ?? null
      const allEntries = keymap ? collectHelpEntries(keymap) : []
      const scopedEntries = scope ? allEntries.filter((e) => e.mode === scope) : allEntries
      return {
        ...state,
        modal: {
          cursorPos: 0,
          editBuffer: '',
          entryCount: scopedEntries.length,
          scope,
          selectedIndex: 0,
          sessionTargetId: null,
          type: 'help',
        },
      }
    }
    case 'open-split-picker':
      return {
        ...state,
        focusMode: 'modal',
        modal: {
          cursorPos: 0,
          editBuffer: null,
          selectedIndex: 0,
          sessionTargetId: null,
          splitDirection: action.direction,
          type: 'split-picker',
        },
      }
    case 'open-session-picker':
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          cursorPos: 0,
          editBuffer: '',
          selectedIndex: 0,
          sessionTargetId: null,
          type: 'session-picker',
        },
      }
    case 'open-session-name-modal': {
      const initialName = action.initialName ?? ''
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          cursorPos: initialName.length,
          editBuffer: initialName,
          selectedIndex: 0,
          sessionTargetId: action.sessionTargetId ?? null,
          type: 'session-name',
        },
      }
    }
    case 'open-create-session-modal':
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          activeField: 'directory',
          cursorPos: 0,
          directoryResults: [],
          editBuffer: '',
          nameBuffer: '',
          pendingProjectPath: null,
          returnToSessionPicker: action.returnToSessionPicker,
          selectedIndex: 0,
          sessionTargetId: null,
          type: 'create-session',
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
        focusMode: 'command-edit',
        modal: {
          cursorPos: 0,
          editBuffer: '',
          selectedIndex: 0,
          sessionTargetId: null,
          type: 'snippet-picker',
        },
      }
    case 'open-snippet-editor': {
      const snippet = action.snippetId
        ? state.snippets.find((s) => s.id === action.snippetId)
        : undefined
      const initialName = snippet?.name ?? ''
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          activeField: 'name',
          contentBuffer: snippet?.content ?? '',
          cursorPos: initialName.length,
          editBuffer: initialName,
          selectedIndex: 0,
          sessionTargetId: snippet?.id ?? null,
          type: 'snippet-editor',
        },
      }
    }
    case 'open-theme-picker':
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          cursorPos: 0,
          editBuffer: '',
          entryCount: 0,
          selectedIndex: 0,
          sessionTargetId: null,
          type: 'theme-picker',
        },
      }
    case 'open-update-available-modal':
      return {
        ...state,
        focusMode: 'modal',
        modal: {
          currentVersion: action.currentVersion,
          cursorPos: 0,
          editBuffer: null,
          latestVersion: action.latestVersion,
          selectedIndex: 0,
          sessionTargetId: null,
          type: 'update-available',
        },
      }
    case 'open-git-commit-modal':
      return {
        ...state,
        focusMode: 'command-edit',
        modal: {
          activeField: 'title',
          contentBuffer: '',
          cursorPos: 0,
          editBuffer: '',
          selectedIndex: 0,
          sessionTargetId: null,
          type: 'git-commit',
        },
      }
    case 'open-auto-commit-modal': {
      const suggestion = state.autoCommit.bySession[action.sessionId]
      if (!suggestion || suggestion.kind !== 'ready') return state
      return {
        ...state,
        focusMode: 'modal',
        modal: {
          body: suggestion.body,
          cursorPos: 0,
          editBuffer: null,
          selectedIndex: 0,
          sessionId: action.sessionId,
          sessionTargetId: action.sessionId,
          title: suggestion.title,
          type: 'auto-commit',
        },
      }
    }
    case 'set-help-entry-count': {
      if (state.modal.type !== 'help') return state
      if (state.modal.entryCount === action.count) {
        // Still clamp selectedIndex in case the count shrank below it.
        const clamped = Math.min(state.modal.selectedIndex, Math.max(0, action.count - 1))
        if (clamped === state.modal.selectedIndex) return state
        return { ...state, modal: { ...state.modal, selectedIndex: clamped } }
      }
      const clamped = Math.min(state.modal.selectedIndex, Math.max(0, action.count - 1))
      return {
        ...state,
        modal: { ...state.modal, entryCount: action.count, selectedIndex: clamped },
      }
    }
    case 'set-theme-entry-count': {
      if (state.modal.type !== 'theme-picker') return state
      const clamped = Math.min(state.modal.selectedIndex, Math.max(0, action.count - 1))
      if (state.modal.entryCount === action.count && clamped === state.modal.selectedIndex) {
        return state
      }
      return {
        ...state,
        modal: { ...state.modal, entryCount: action.count, selectedIndex: clamped },
      }
    }
    case 'close-modal': {
      const closingType = state.modal.type
      // Help is a pure overlay — it never flipped focusMode, so leave it alone.
      if (closingType === 'help') {
        return { ...state, modal: emptyModal() }
      }
      const nextFocus: AppState['focusMode'] = closingType === 'git-commit' ? 'git' : 'navigation'
      return { ...state, focusMode: nextFocus, modal: emptyModal() }
    }
    case 'move-modal-selection': {
      if (state.modal.type === 'help') {
        const count = state.modal.entryCount
        if (count <= 0) return state
        const raw = state.modal.selectedIndex + action.delta
        const nextIndex = ((raw % count) + count) % count
        if (nextIndex === state.modal.selectedIndex) return state
        return { ...state, modal: { ...state.modal, selectedIndex: nextIndex } }
      }
      if (
        state.modal.type !== 'new-tab' &&
        state.modal.type !== 'session-picker' &&
        state.modal.type !== 'snippet-picker' &&
        state.modal.type !== 'theme-picker' &&
        state.modal.type !== 'create-session' &&
        state.modal.type !== 'split-picker' &&
        state.modal.type !== 'update-available'
      ) {
        return state
      }
      if (state.modal.type === 'create-session' && state.modal.activeField !== 'directory') {
        return state
      }
      let optionCount: number
      if (state.modal.type === 'new-tab') {
        optionCount = filterAssistants(
          getAllAssistantOptions(state.customCommands),
          state.modal.editBuffer
        ).length
      } else if (state.modal.type === 'split-picker') {
        optionCount = getAllAssistantOptions(state.customCommands).length
      } else if (state.modal.type === 'create-session') {
        optionCount = state.modal.directoryResults.length
      } else if (state.modal.type === 'snippet-picker') {
        const filtered = filterSnippets(state.snippets, state.modal.editBuffer)
        optionCount = filtered.length
      } else if (state.modal.type === 'theme-picker') {
        optionCount = filterThemeIds(state.modal.editBuffer).length
      } else if (state.modal.type === 'update-available') {
        optionCount = 2
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
    case 'set-modal-selection-index': {
      if (
        state.modal.type !== 'new-tab' &&
        state.modal.type !== 'session-picker' &&
        state.modal.type !== 'snippet-picker' &&
        state.modal.type !== 'theme-picker' &&
        state.modal.type !== 'create-session' &&
        state.modal.type !== 'split-picker' &&
        state.modal.type !== 'update-available' &&
        state.modal.type !== 'help'
      ) {
        return state
      }
      let optionCount: number
      if (state.modal.type === 'help') {
        optionCount = state.modal.entryCount
      } else if (state.modal.type === 'new-tab') {
        optionCount = filterAssistants(
          getAllAssistantOptions(state.customCommands),
          state.modal.editBuffer
        ).length
      } else if (state.modal.type === 'split-picker') {
        optionCount = getAllAssistantOptions(state.customCommands).length
      } else if (state.modal.type === 'create-session') {
        optionCount = state.modal.directoryResults.length
      } else if (state.modal.type === 'snippet-picker') {
        optionCount = filterSnippets(state.snippets, state.modal.editBuffer).length
      } else if (state.modal.type === 'theme-picker') {
        optionCount = filterThemeIds(state.modal.editBuffer).length
      } else if (state.modal.type === 'update-available') {
        optionCount = 2
      } else {
        optionCount = Math.max(1, filterSessions(state.sessions, state.modal.editBuffer).length + 1)
      }
      if (optionCount === 0) return state
      const clamped = Math.max(0, Math.min(optionCount - 1, action.index))
      if (clamped === state.modal.selectedIndex) return state
      return { ...state, modal: { ...state.modal, selectedIndex: clamped } }
    }
    case 'move-modal-cursor': {
      if (state.modal.editBuffer === null) return state
      const len = state.modal.editBuffer.length
      const current = state.modal.cursorPos ?? len
      let next = current
      if (action.to === 'home') next = 0
      else if (action.to === 'end') next = len
      else if (typeof action.delta === 'number') next = current + action.delta
      next = clampCursor(next, len)
      if (next === current) return state
      return { ...state, modal: { ...state.modal, cursorPos: next } }
    }
    case 'update-command-edit': {
      if (state.modal.editBuffer === null) {
        return state
      }
      const buffer = state.modal.editBuffer
      const cursor = clampCursor(state.modal.cursorPos ?? buffer.length, buffer.length)
      let nextBuffer: string
      let nextCursor: number
      if (action.char === '\b') {
        if (cursor === 0) return state
        nextBuffer = buffer.slice(0, cursor - 1) + buffer.slice(cursor)
        nextCursor = cursor - 1
      } else {
        nextBuffer = buffer.slice(0, cursor) + action.char + buffer.slice(cursor)
        nextCursor = cursor + action.char.length
      }
      const isNewTabEditing = state.modal.type === 'new-tab' && state.modal.editingCommand !== null
      const resetIndex =
        !isNewTabEditing &&
        (state.modal.type === 'session-picker' ||
          state.modal.type === 'snippet-picker' ||
          state.modal.type === 'theme-picker' ||
          state.modal.type === 'new-tab' ||
          state.modal.type === 'help')
          ? 0
          : state.modal.selectedIndex
      return {
        ...state,
        modal: {
          ...state.modal,
          cursorPos: nextCursor,
          editBuffer: nextBuffer,
          selectedIndex: resetIndex,
        },
      }
    }
    case 'cancel-command-edit': {
      if (state.modal.type === 'new-tab' && state.modal.editingCommand !== null) {
        return {
          ...state,
          modal: {
            ...state.modal,
            cursorPos: 0,
            editBuffer: '',
            editingCommand: null,
          },
        }
      }
      if (state.modal.type === 'create-session' || state.modal.type === 'snippet-editor') {
        return { ...state, focusMode: 'navigation', modal: emptyModal() }
      }
      // Pickers and overlays with auto-filter — Esc closes the modal entirely.
      if (
        state.modal.type === 'session-picker' ||
        state.modal.type === 'snippet-picker' ||
        state.modal.type === 'theme-picker' ||
        state.modal.type === 'new-tab' ||
        state.modal.type === 'help'
      ) {
        return { ...state, focusMode: 'navigation', modal: emptyModal() }
      }
      return {
        ...state,
        focusMode: 'modal',
        modal: { ...state.modal, cursorPos: 0, editBuffer: null },
      }
    }
    case 'switch-create-session-field': {
      if (state.modal.type === 'create-session') {
        const nextField = state.modal.activeField === 'directory' ? 'name' : 'directory'
        const nextEdit = state.modal.nameBuffer
        return {
          ...state,
          modal: {
            ...state.modal,
            activeField: nextField,
            cursorPos: nextEdit.length,
            editBuffer: nextEdit,
            nameBuffer: state.modal.editBuffer ?? '',
          },
        }
      }
      if (state.modal.type === 'snippet-editor') {
        const nextField = state.modal.activeField === 'name' ? 'content' : 'name'
        const nextEdit = state.modal.contentBuffer
        return {
          ...state,
          modal: {
            ...state.modal,
            activeField: nextField,
            contentBuffer: state.modal.editBuffer ?? '',
            cursorPos: nextEdit.length,
            editBuffer: nextEdit,
          },
        }
      }
      if (state.modal.type === 'git-commit') {
        const nextField = state.modal.activeField === 'title' ? 'body' : 'title'
        const nextEdit = state.modal.contentBuffer
        return {
          ...state,
          modal: {
            ...state.modal,
            activeField: nextField,
            contentBuffer: state.modal.editBuffer ?? '',
            cursorPos: nextEdit.length,
            editBuffer: nextEdit,
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
          activeField: 'name',
          cursorPos: autoName.length,
          editBuffer: autoName,
          nameBuffer:
            state.modal.activeField === 'directory'
              ? (state.modal.editBuffer ?? '')
              : state.modal.nameBuffer,
          pendingProjectPath: selected.path,
        },
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
          cursorPos: activeTab.title.length,
          editBuffer: activeTab.title,
          selectedIndex: 0,
          sessionTargetId: activeTab.id,
          type: 'rename-tab',
        },
      }
    }
    default:
      return null
  }
}

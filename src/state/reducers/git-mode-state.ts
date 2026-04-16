import type { AppAction, AppState, GitFileEntry, GitModeState } from '../types'

import { sortFilesBySection } from './git-panel-state'

export function emptyGitMode(): GitModeState {
  return {
    actionMessage: null,
    diffs: {},
    loading: {},
    pendingDeletePath: null,
    selectedFileIndex: 0,
  }
}

export function reduceGitModeState(state: AppState, action: AppAction): AppState | null {
  switch (action.type) {
    case 'enter-git-mode': {
      if (state.focusMode === 'git') return state
      return {
        ...state,
        focusMode: 'git',
        gitMode: {
          ...state.gitMode,
          actionMessage: null,
          pendingDeletePath: null,
          selectedFileIndex: 0,
        },
      }
    }
    case 'exit-git-mode': {
      if (state.focusMode !== 'git') return state
      return { ...state, focusMode: 'navigation' }
    }
    case 'git-mode-select-file': {
      const total = state.gitPanel.files.length
      if (total === 0) return state
      const next = (state.gitMode.selectedFileIndex + action.delta + total) % total
      if (next === state.gitMode.selectedFileIndex) return state
      return {
        ...state,
        gitMode: {
          ...state.gitMode,
          pendingDeletePath: null,
          selectedFileIndex: next,
        },
      }
    }
    case 'git-mode-set-diff': {
      const nextLoading = { ...state.gitMode.loading }
      delete nextLoading[action.path]
      return {
        ...state,
        gitMode: {
          ...state.gitMode,
          diffs: { ...state.gitMode.diffs, [action.path]: action.diff },
          loading: nextLoading,
        },
      }
    }
    case 'git-mode-set-loading': {
      const nextLoading = { ...state.gitMode.loading }
      if (action.loading) {
        nextLoading[action.path] = true
      } else {
        delete nextLoading[action.path]
      }
      return { ...state, gitMode: { ...state.gitMode, loading: nextLoading } }
    }
    case 'git-mode-set-pending-delete': {
      if (state.gitMode.pendingDeletePath === action.path) return state
      return { ...state, gitMode: { ...state.gitMode, pendingDeletePath: action.path } }
    }
    case 'git-mode-clear-diff-cache': {
      if (!(action.path in state.gitMode.diffs)) return state
      const nextDiffs = { ...state.gitMode.diffs }
      delete nextDiffs[action.path]
      return { ...state, gitMode: { ...state.gitMode, diffs: nextDiffs } }
    }
    case 'git-mode-set-message': {
      if (state.gitMode.actionMessage === action.message) return state
      return { ...state, gitMode: { ...state.gitMode, actionMessage: action.message } }
    }
    case 'git-mode-optimistic-move': {
      const currentIdx = state.gitMode.selectedFileIndex
      const files = state.gitPanel.files
      const idx = files.findIndex((f) => f.path === action.path && f.section === action.fromSection)
      if (idx < 0) return state

      const toSection = action.toSection
      let nextFiles: GitFileEntry[]
      if (toSection === null) {
        nextFiles = files.filter((_, i) => i !== idx)
      } else {
        const duplicateIdx = files.findIndex(
          (f, i) => i !== idx && f.path === action.path && f.section === toSection
        )
        if (duplicateIdx >= 0) {
          nextFiles = files.filter((_, i) => i !== idx)
        } else {
          nextFiles = files.map((f, i) =>
            i === idx ? ({ ...f, section: toSection } as GitFileEntry) : f
          )
        }
      }
      nextFiles = sortFilesBySection(nextFiles)

      const newLen = nextFiles.length
      let nextIdx: number
      if (newLen === 0) {
        nextIdx = 0
      } else {
        const movedIdx =
          toSection === null
            ? -1
            : nextFiles.findIndex((f) => f.path === action.path && f.section === toSection)
        if (movedIdx === currentIdx) {
          nextIdx = (currentIdx + 1) % newLen
        } else {
          nextIdx = Math.min(currentIdx, newLen - 1)
        }
      }

      return {
        ...state,
        gitMode: {
          ...state.gitMode,
          pendingDeletePath: null,
          selectedFileIndex: nextIdx,
        },
        gitPanel: { ...state.gitPanel, files: nextFiles },
      }
    }
    default:
      return null
  }
}

import type { AppAction, AppState, FoldState, GitFileEntry, GitModeState } from '../types'

import { sortFilesBySection } from './git-panel-state'

function applyFold(state: AppState, path: string, foldId: string, next: FoldState): AppState {
  const perPath = state.gitMode.folds[path] ?? {}
  const prev = perPath[foldId] ?? { bottom: 0, top: 0 }
  if (prev.top === next.top && prev.bottom === next.bottom) return state
  const nextPerPath = { ...perPath }
  if (next.top === 0 && next.bottom === 0) {
    delete nextPerPath[foldId]
  } else {
    nextPerPath[foldId] = next
  }
  const nextFolds = { ...state.gitMode.folds }
  if (Object.keys(nextPerPath).length === 0) {
    delete nextFolds[path]
  } else {
    nextFolds[path] = nextPerPath
  }
  return { ...state, gitMode: { ...state.gitMode, folds: nextFolds } }
}

export function emptyGitMode(): GitModeState {
  return {
    actionMessage: null,
    diffs: {},
    diffView: 'split',
    folds: {},
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
    case 'git-mode-select-file-by-key': {
      const index = state.gitPanel.files.findIndex(
        (f) => f.section === action.section && f.path === action.path
      )
      if (index < 0 || index === state.gitMode.selectedFileIndex) return state
      return {
        ...state,
        gitMode: {
          ...state.gitMode,
          pendingDeletePath: null,
          selectedFileIndex: index,
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
      const hasDiff = action.path in state.gitMode.diffs
      const hasFolds = action.path in state.gitMode.folds
      if (!hasDiff && !hasFolds) return state
      const nextDiffs = hasDiff ? { ...state.gitMode.diffs } : state.gitMode.diffs
      if (hasDiff) delete nextDiffs[action.path]
      const nextFolds = hasFolds ? { ...state.gitMode.folds } : state.gitMode.folds
      if (hasFolds) delete nextFolds[action.path]
      return {
        ...state,
        gitMode: { ...state.gitMode, diffs: nextDiffs, folds: nextFolds },
      }
    }
    case 'git-mode-set-message': {
      if (state.gitMode.actionMessage === action.message) return state
      return { ...state, gitMode: { ...state.gitMode, actionMessage: action.message } }
    }
    case 'git-mode-toggle-diff-view': {
      const next = state.gitMode.diffView === 'split' ? 'stacked' : 'split'
      return { ...state, gitMode: { ...state.gitMode, diffView: next } }
    }
    case 'git-mode-fold-adjust': {
      const perPath = state.gitMode.folds[action.path] ?? {}
      const prev = perPath[action.foldId] ?? { bottom: 0, top: 0 }
      const nextSide = Math.max(0, prev[action.side] + action.delta)
      const nextFold =
        action.side === 'top'
          ? { bottom: prev.bottom, top: nextSide }
          : { bottom: nextSide, top: prev.top }
      return applyFold(state, action.path, action.foldId, nextFold)
    }
    case 'git-mode-fold-set': {
      const top = Math.max(0, action.top)
      const bottom = Math.max(0, action.bottom)
      return applyFold(state, action.path, action.foldId, { bottom, top })
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

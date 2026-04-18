import type { AppAction, AppState, FoldState, GitFileEntry, GitModeState } from '../types'

import {
  getSelectedGitRow,
  gitFileKey,
  moveGitFileSelection,
  moveGitSelection,
  reconcileSelectedGitEntryKey,
} from '../git-tree'
import { sortFilesBySection } from './git-panel-state'

function applyFold(state: AppState, key: string, foldId: string, next: FoldState): AppState {
  const perPath = state.gitMode.folds[key] ?? {}
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
    delete nextFolds[key]
  } else {
    nextFolds[key] = nextPerPath
  }
  return { ...state, gitMode: { ...state.gitMode, folds: nextFolds } }
}

function clearDiffCacheForPath(state: AppState, path: string): AppState {
  const nextDiffs = { ...state.gitMode.diffs }
  const nextFolds = { ...state.gitMode.folds }
  const nextLoading = { ...state.gitMode.loading }
  let changed = false
  for (const key of Object.keys(nextDiffs)) {
    if (nextDiffs[key]?.path !== path) continue
    delete nextDiffs[key]
    changed = true
  }
  for (const key of Object.keys(nextFolds)) {
    if (!key.endsWith(`:${path}`)) continue
    delete nextFolds[key]
    changed = true
  }
  for (const key of Object.keys(nextLoading)) {
    if (!key.endsWith(`:${path}`)) continue
    delete nextLoading[key]
    changed = true
  }
  if (!changed) return state
  return {
    ...state,
    gitMode: { ...state.gitMode, diffs: nextDiffs, folds: nextFolds, loading: nextLoading },
  }
}

export function emptyGitMode(): GitModeState {
  return {
    actionMessage: null,
    collapsedFolders: {},
    diffs: {},
    diffView: 'split',
    folds: {},
    loading: {},
    pendingDeletePath: null,
    selectedEntryKey: null,
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
          selectedEntryKey: reconcileSelectedGitEntryKey(
            state.gitPanel.files,
            state.gitMode.collapsedFolders,
            state.gitPane.fileListMode,
            null
          ),
        },
      }
    }
    case 'exit-git-mode': {
      if (state.focusMode !== 'git') return state
      return { ...state, focusMode: 'navigation' }
    }
    case 'git-mode-move-selection': {
      const next = moveGitSelection(
        state.gitPanel.files,
        state.gitMode.collapsedFolders,
        state.gitPane.fileListMode,
        state.gitMode.selectedEntryKey,
        action.delta
      )
      if (!next || next === state.gitMode.selectedEntryKey) return state
      return {
        ...state,
        gitMode: {
          ...state.gitMode,
          pendingDeletePath: null,
          selectedEntryKey: next,
        },
      }
    }
    case 'git-mode-move-file-selection': {
      const next = moveGitFileSelection(
        state.gitPanel.files,
        state.gitMode.collapsedFolders,
        state.gitPane.fileListMode,
        state.gitMode.selectedEntryKey,
        action.delta
      )
      if (!next || next === state.gitMode.selectedEntryKey) return state
      return {
        ...state,
        gitMode: {
          ...state.gitMode,
          pendingDeletePath: null,
          selectedEntryKey: next,
        },
      }
    }
    case 'git-mode-select-entry-by-key': {
      const next = reconcileSelectedGitEntryKey(
        state.gitPanel.files,
        state.gitMode.collapsedFolders,
        state.gitPane.fileListMode,
        state.gitMode.selectedEntryKey,
        [action.key]
      )
      if (!next || next !== action.key || next === state.gitMode.selectedEntryKey) return state
      return {
        ...state,
        gitMode: {
          ...state.gitMode,
          pendingDeletePath: null,
          selectedEntryKey: next,
        },
      }
    }
    case 'git-mode-toggle-folder': {
      const row = getSelectedGitRow(state.gitPanel.files, {
        collapsedFolders: state.gitMode.collapsedFolders,
        fileListMode: state.gitPane.fileListMode,
        selectedEntryKey: action.key,
      })
      if (!row || row.kind !== 'folder') return state
      const nextCollapsed = { ...state.gitMode.collapsedFolders }
      if (action.key in nextCollapsed) {
        delete nextCollapsed[action.key]
      } else {
        nextCollapsed[action.key] = true
      }
      return { ...state, gitMode: { ...state.gitMode, collapsedFolders: nextCollapsed } }
    }
    case 'git-mode-toggle-selected-folder': {
      const row = getSelectedGitRow(state.gitPanel.files, {
        collapsedFolders: state.gitMode.collapsedFolders,
        fileListMode: state.gitPane.fileListMode,
        selectedEntryKey: state.gitMode.selectedEntryKey,
      })
      if (!row || row.kind !== 'folder') return state
      const nextCollapsed = { ...state.gitMode.collapsedFolders }
      if (row.key in nextCollapsed) {
        delete nextCollapsed[row.key]
      } else {
        nextCollapsed[row.key] = true
      }
      return { ...state, gitMode: { ...state.gitMode, collapsedFolders: nextCollapsed } }
    }
    case 'git-mode-collapse-selection': {
      const row = getSelectedGitRow(state.gitPanel.files, {
        collapsedFolders: state.gitMode.collapsedFolders,
        fileListMode: state.gitPane.fileListMode,
        selectedEntryKey: state.gitMode.selectedEntryKey,
      })
      if (!row) return state
      if (row.kind === 'folder' && !row.isCollapsed) {
        return {
          ...state,
          gitMode: {
            ...state.gitMode,
            collapsedFolders: { ...state.gitMode.collapsedFolders, [row.key]: true },
          },
        }
      }
      if (!row.parentKey || row.parentKey === state.gitMode.selectedEntryKey) return state
      return {
        ...state,
        gitMode: {
          ...state.gitMode,
          pendingDeletePath: null,
          selectedEntryKey: row.parentKey,
        },
      }
    }
    case 'git-mode-expand-selection': {
      const row = getSelectedGitRow(state.gitPanel.files, {
        collapsedFolders: state.gitMode.collapsedFolders,
        fileListMode: state.gitPane.fileListMode,
        selectedEntryKey: state.gitMode.selectedEntryKey,
      })
      if (!row || row.kind !== 'folder' || !row.isCollapsed) return state
      const nextCollapsed = { ...state.gitMode.collapsedFolders }
      delete nextCollapsed[row.key]
      return { ...state, gitMode: { ...state.gitMode, collapsedFolders: nextCollapsed } }
    }
    case 'git-mode-toggle-file-list-mode': {
      const fileListMode = state.gitPane.fileListMode === 'tree' ? 'flat' : 'tree'
      return {
        ...state,
        gitMode: {
          ...state.gitMode,
          pendingDeletePath: null,
          selectedEntryKey: reconcileSelectedGitEntryKey(
            state.gitPanel.files,
            state.gitMode.collapsedFolders,
            fileListMode,
            state.gitMode.selectedEntryKey
          ),
        },
        gitPane: { ...state.gitPane, fileListMode },
      }
    }
    case 'git-mode-set-diff': {
      const nextLoading = { ...state.gitMode.loading }
      delete nextLoading[action.key]
      return {
        ...state,
        gitMode: {
          ...state.gitMode,
          diffs: { ...state.gitMode.diffs, [action.key]: action.diff },
          loading: nextLoading,
        },
      }
    }
    case 'git-mode-set-loading': {
      const nextLoading = { ...state.gitMode.loading }
      if (action.loading) {
        nextLoading[action.key] = true
      } else {
        delete nextLoading[action.key]
      }
      return { ...state, gitMode: { ...state.gitMode, loading: nextLoading } }
    }
    case 'git-mode-set-pending-delete': {
      if (state.gitMode.pendingDeletePath === action.path) return state
      return { ...state, gitMode: { ...state.gitMode, pendingDeletePath: action.path } }
    }
    case 'git-mode-clear-diff-cache': {
      return clearDiffCacheForPath(state, action.path)
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
      const perPath = state.gitMode.folds[action.key] ?? {}
      const prev = perPath[action.foldId] ?? { bottom: 0, top: 0 }
      const nextSide = Math.max(0, prev[action.side] + action.delta)
      const nextFold =
        action.side === 'top'
          ? { bottom: prev.bottom, top: nextSide }
          : { bottom: nextSide, top: prev.top }
      return applyFold(state, action.key, action.foldId, nextFold)
    }
    case 'git-mode-fold-set': {
      const top = Math.max(0, action.top)
      const bottom = Math.max(0, action.bottom)
      return applyFold(state, action.key, action.foldId, { bottom, top })
    }
    case 'git-mode-optimistic-move': {
      const currentKey = state.gitMode.selectedEntryKey
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
      const movedCurrentKey = gitFileKey({ path: action.path, section: action.fromSection })
      const preferredSelection =
        currentKey === movedCurrentKey && toSection !== null
          ? [gitFileKey({ path: action.path, section: toSection })]
          : []
      const nextSelectedEntryKey = reconcileSelectedGitEntryKey(
        nextFiles,
        state.gitMode.collapsedFolders,
        state.gitPane.fileListMode,
        currentKey,
        preferredSelection
      )

      return {
        ...state,
        gitMode: {
          ...state.gitMode,
          pendingDeletePath: null,
          selectedEntryKey: nextSelectedEntryKey,
        },
        gitPanel: { ...state.gitPanel, files: nextFiles },
      }
    }
    default:
      return null
  }
}

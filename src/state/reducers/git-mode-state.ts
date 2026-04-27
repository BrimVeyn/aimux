import type { PreparedParsedDiff } from '../../ui/components/git/diff-renderer/prepare-diff'

import { collectFoldables } from '../../ui/components/git/diff-renderer/build-rows'
import {
  getSelectedGitRow,
  gitFileKey,
  moveGitFileSelection,
  moveGitSelection,
  reconcileSelectedGitEntryKey,
} from '../git-tree'
import {
  type AppAction,
  type AppState,
  type FoldState,
  getParsedPayload,
  type GitFileEntry,
  type GitModeState,
} from '../types'
import { clearDiffCacheForPath, clearDiffCacheForPaths } from './diff-cache'
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

export function emptyGitMode(): GitModeState {
  return {
    actionMessage: null,
    collapsedFolders: {},
    diffs: {},
    diffView: 'split',
    folds: {},
    headOffset: 0,
    highlights: {},
    loading: {},
    parsedFiles: {},
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
            null,
            [],
            state.gitPane.treeCompaction
          ),
        },
      }
    }
    case 'exit-git-mode': {
      if (state.focusMode !== 'git') return state
      return {
        ...state,
        focusMode: 'navigation',
        gitMode: {
          ...state.gitMode,
          actionMessage: null,
          diffs: {},
          folds: {},
          headOffset: 0,
          highlights: {},
          loading: {},
          parsedFiles: {},
        },
      }
    }
    case 'git-mode-move-selection': {
      const next = moveGitSelection(
        state.gitPanel.files,
        state.gitMode.collapsedFolders,
        state.gitPane.fileListMode,
        state.gitMode.selectedEntryKey,
        action.delta,
        state.gitPane.treeCompaction
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
        action.delta,
        state.gitPane.treeCompaction
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
        [action.key],
        state.gitPane.treeCompaction
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
        compact: state.gitPane.treeCompaction,
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
        compact: state.gitPane.treeCompaction,
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
        compact: state.gitPane.treeCompaction,
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
        compact: state.gitPane.treeCompaction,
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
            state.gitMode.selectedEntryKey,
            [],
            state.gitPane.treeCompaction
          ),
        },
        gitPane: { ...state.gitPane, fileListMode },
      }
    }
    case 'git-mode-toggle-tree-compaction': {
      const treeCompaction = !state.gitPane.treeCompaction
      return {
        ...state,
        gitMode: {
          ...state.gitMode,
          pendingDeletePath: null,
          selectedEntryKey: reconcileSelectedGitEntryKey(
            state.gitPanel.files,
            state.gitMode.collapsedFolders,
            state.gitPane.fileListMode,
            state.gitMode.selectedEntryKey,
            [],
            treeCompaction
          ),
        },
        gitPane: { ...state.gitPane, treeCompaction },
      }
    }
    case 'git-mode-set-diff': {
      const nextLoading = { ...state.gitMode.loading }
      delete nextLoading[action.key]
      // Drop stale derived entries (parsed + highlights) whose hash no longer matches.
      const nextParsed = { ...state.gitMode.parsedFiles }
      const prevParsed = nextParsed[action.key]
      if (prevParsed && prevParsed.hash !== action.hash) delete nextParsed[action.key]
      const nextHighlights = { ...state.gitMode.highlights }
      for (const key of Object.keys(nextHighlights)) {
        if (!key.startsWith(`${action.key}|`)) continue
        if (nextHighlights[key]?.hash !== action.hash) delete nextHighlights[key]
      }
      return {
        ...state,
        gitMode: {
          ...state.gitMode,
          diffs: { ...state.gitMode.diffs, [action.key]: action.diff },
          highlights: nextHighlights,
          loading: nextLoading,
          parsedFiles: nextParsed,
        },
      }
    }
    case 'git-mode-set-parsed': {
      const prevParsed = state.gitMode.parsedFiles[action.key]
      if (prevParsed && prevParsed.hash === action.hash) return state
      return {
        ...state,
        gitMode: {
          ...state.gitMode,
          parsedFiles: {
            ...state.gitMode.parsedFiles,
            [action.key]: { file: action.file, hash: action.hash },
          },
        },
      }
    }
    case 'git-mode-set-highlights': {
      const k = `${action.key}|${action.themeId}`
      return {
        ...state,
        gitMode: {
          ...state.gitMode,
          highlights: {
            ...state.gitMode.highlights,
            [k]: {
              add: action.add,
              del: action.del,
              hash: action.hash,
              themeId: action.themeId,
            },
          },
        },
      }
    }
    case 'git-mode-merge-highlights': {
      const k = `${action.key}|${action.themeId}`
      const existing = state.gitMode.highlights[k]
      const sameContent = existing && existing.hash === action.hash
      if (sameContent) {
        const existingAdd = existing.add as unknown[]
        const existingDel = existing.del as unknown[]
        let changesAnything = false
        outer: for (const patch of action.add) {
          const tokens = patch.tokens as unknown[]
          for (let i = 0; i < tokens.length; i++) {
            if (existingAdd[patch.start + i] === undefined) {
              changesAnything = true
              break outer
            }
          }
        }
        if (!changesAnything) {
          outer: for (const patch of action.del) {
            const tokens = patch.tokens as unknown[]
            for (let i = 0; i < tokens.length; i++) {
              if (existingDel[patch.start + i] === undefined) {
                changesAnything = true
                break outer
              }
            }
          }
        }
        if (!changesAnything) return state
      }
      const nextAdd = sameContent ? ([...(existing.add as unknown[])] as unknown[]) : []
      const nextDel = sameContent ? ([...(existing.del as unknown[])] as unknown[]) : []
      for (const patch of action.add) {
        const tokens = patch.tokens as unknown[]
        for (let i = 0; i < tokens.length; i++) nextAdd[patch.start + i] = tokens[i]
      }
      for (const patch of action.del) {
        const tokens = patch.tokens as unknown[]
        for (let i = 0; i < tokens.length; i++) nextDel[patch.start + i] = tokens[i]
      }
      return {
        ...state,
        gitMode: {
          ...state.gitMode,
          highlights: {
            ...state.gitMode.highlights,
            [k]: {
              add: nextAdd,
              del: nextDel,
              hash: action.hash,
              themeId: action.themeId,
            },
          },
        },
      }
    }
    case 'git-mode-invalidate-diffs': {
      if (action.paths.length === 0) return state
      return clearDiffCacheForPaths(state, new Set(action.paths))
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
    case 'git-mode-shift-head-offset': {
      const next = Math.max(0, state.gitMode.headOffset + action.delta)
      if (next === state.gitMode.headOffset) return state
      return {
        ...state,
        gitMode: {
          ...state.gitMode,
          actionMessage: null,
          diffs: {},
          folds: {},
          headOffset: next,
          highlights: {},
          loading: {},
          parsedFiles: {},
          pendingDeletePath: null,
        },
      }
    }
    case 'git-mode-set-head-offset': {
      const next = Math.max(0, action.offset)
      if (next === state.gitMode.headOffset) return state
      return {
        ...state,
        gitMode: {
          ...state.gitMode,
          diffs: {},
          folds: {},
          headOffset: next,
          highlights: {},
          loading: {},
          parsedFiles: {},
          pendingDeletePath: null,
        },
      }
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
    case 'git-mode-fold-toggle-all': {
      const parsed = getParsedPayload<PreparedParsedDiff>(state.gitMode.parsedFiles[action.key])
      const file = parsed?.file
      if (!file || !Array.isArray(file.hunks)) return state
      const foldables = collectFoldables(file)
      if (foldables.length === 0) return state
      const current = state.gitMode.folds[action.key] ?? {}
      const allExpanded = foldables.every(({ foldId, middle }) => {
        const fs = current[foldId] ?? { bottom: 0, top: 0 }
        return fs.top + fs.bottom >= middle
      })
      const nextFolds = { ...state.gitMode.folds }
      if (allExpanded) {
        delete nextFolds[action.key]
      } else {
        const perPath: Record<string, FoldState> = {}
        for (const { foldId, middle } of foldables) {
          perPath[foldId] = { bottom: 0, top: middle }
        }
        nextFolds[action.key] = perPath
      }
      return { ...state, gitMode: { ...state.gitMode, folds: nextFolds } }
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
        preferredSelection,
        state.gitPane.treeCompaction
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

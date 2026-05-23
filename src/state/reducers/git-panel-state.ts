import type {
  AppAction,
  AppState,
  BranchDivergence,
  GitFileEntry,
  GitFileSection,
  GitPanelState,
} from '../types'

import { clampGitPaneRatio } from '../git-pane-sizing'
import { reconcileSelectedGitEntryKey } from '../git-tree'
import { clearDiffCacheForPaths } from './diff-cache'

const SECTION_RANK: Record<GitFileSection, number> = {
  historical: 0,
  staged: 1,
  unstaged: 2,
  untracked: 3,
}

export function sortFilesBySection(files: GitFileEntry[]): GitFileEntry[] {
  return [...files].sort((a, b) => {
    const sa = SECTION_RANK[a.section]
    const sb = SECTION_RANK[b.section]
    if (sa !== sb) return sa - sb
    const ra = a.repoPath ?? ''
    const rb = b.repoPath ?? ''
    if (ra !== rb) return ra.localeCompare(rb)
    return a.path.localeCompare(b.path)
  })
}

function clampRatio(value: number): number {
  return clampGitPaneRatio(value)
}

function sameDivergence(
  a: Record<string, BranchDivergence>,
  b: Record<string, BranchDivergence>
): boolean {
  const aKeys = Object.keys(a)
  if (aKeys.length !== Object.keys(b).length) return false
  for (const key of aKeys) {
    const x = a[key]
    const y = b[key]
    if (x == null || y == null || x.ahead !== y.ahead || x.behind !== y.behind) return false
  }
  return true
}

export function emptyGitPanel(): GitPanelState {
  return {
    ahead: 0,
    behind: 0,
    branch: null,
    error: null,
    files: [],
  }
}

function fileSignature(f: GitFileEntry): string {
  return `${f.status}|${f.added ?? '-'}|${f.removed ?? '-'}|${f.renamedFrom ?? ''}`
}

// Paths whose content/status shifted between two snapshots — used to drop
// stale cached diffs so we re-fetch instead of serving pre-edit data.
function diffChangedPaths(prev: GitFileEntry[], next: GitFileEntry[]): Set<string> {
  const prevByKey = new Map<string, string>()
  for (const f of prev) prevByKey.set(`${f.section}:${f.path}`, fileSignature(f))
  const changed = new Set<string>()
  const nextKeys = new Set<string>()
  for (const f of next) {
    const key = `${f.section}:${f.path}`
    nextKeys.add(key)
    const prevSig = prevByKey.get(key)
    if (prevSig !== fileSignature(f)) changed.add(f.path)
  }
  for (const [key, _sig] of prevByKey) {
    if (nextKeys.has(key)) continue
    const [, ...rest] = key.split(':')
    const path = rest.join(':')
    if (path) changed.add(path)
  }
  return changed
}

function sameFiles(a: GitFileEntry[], b: GitFileEntry[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as GitFileEntry
    const y = b[i] as GitFileEntry
    if (
      x.path !== y.path ||
      x.status !== y.status ||
      x.section !== y.section ||
      x.added !== y.added ||
      x.removed !== y.removed ||
      x.renamedFrom !== y.renamedFrom
    ) {
      return false
    }
  }
  return true
}

export function reduceGitPanelState(state: AppState, action: AppAction): AppState | null {
  switch (action.type) {
    case 'toggle-git-pane': {
      const nextVisible = !state.gitPane.visible
      const sidebarMustShow = state.gitPane.mode === 'embedded' && nextVisible
      return {
        ...state,
        gitPane: { ...state.gitPane, visible: nextVisible },
        sidebar: sidebarMustShow ? { ...state.sidebar, visible: true } : state.sidebar,
      }
    }
    case 'resize-git-pane': {
      const target = state.gitPane.mode === 'pane' ? 'paneRatio' : 'embeddedRatio'
      const nextRatio = clampRatio(state.gitPane[target] + action.delta)
      if (nextRatio === state.gitPane[target]) return state
      return { ...state, gitPane: { ...state.gitPane, [target]: nextRatio } }
    }
    case 'set-git-pane-ratio': {
      const key = action.target === 'pane' ? 'paneRatio' : 'embeddedRatio'
      const nextRatio = clampRatio(action.ratio)
      if (nextRatio === state.gitPane[key]) return state
      return { ...state, gitPane: { ...state.gitPane, [key]: nextRatio } }
    }
    case 'resize-git-diff-pane': {
      const nextRatio = clampRatio(state.gitPane.diffModeRatio + action.delta)
      if (nextRatio === state.gitPane.diffModeRatio) return state
      return { ...state, gitPane: { ...state.gitPane, diffModeRatio: nextRatio } }
    }
    case 'set-git-pane-mode': {
      if (state.gitPane.mode === action.mode) return state
      const isEmbedded = action.mode === 'embedded'
      const isValidEmbedded =
        state.gitPane.position === 'top' || state.gitPane.position === 'bottom'
      const isValidPane = state.gitPane.position === 'left' || state.gitPane.position === 'right'
      let nextPosition: typeof state.gitPane.position
      if (isEmbedded) {
        nextPosition = isValidEmbedded ? state.gitPane.position : 'bottom'
      } else {
        nextPosition = isValidPane ? state.gitPane.position : 'left'
      }
      return {
        ...state,
        gitPane: { ...state.gitPane, mode: action.mode, position: nextPosition },
      }
    }
    case 'set-git-pane-position': {
      const validForMode =
        state.gitPane.mode === 'embedded'
          ? action.position === 'top' || action.position === 'bottom'
          : action.position === 'left' || action.position === 'right'
      if (!validForMode) return state
      if (state.gitPane.position === action.position) return state
      return { ...state, gitPane: { ...state.gitPane, position: action.position } }
    }
    case 'git-refresh-success': {
      const prev = state.gitPanel
      const next = action.payload
      const sortedNext = sortFilesBySection(next.files)
      const nextSelectedEntryKey = reconcileSelectedGitEntryKey(
        sortedNext,
        state.gitMode.collapsedFolders,
        state.gitPane.fileListMode,
        state.gitMode.selectedEntryKey,
        [],
        state.gitPane.treeCompaction
      )
      if (
        prev.branch === next.branch &&
        prev.ahead === next.ahead &&
        prev.behind === next.behind &&
        prev.error === null &&
        sameFiles(prev.files, sortedNext) &&
        nextSelectedEntryKey === state.gitMode.selectedEntryKey
      ) {
        return state
      }
      const changedPaths = diffChangedPaths(prev.files, sortedNext)
      const base: AppState = {
        ...state,
        gitMode: { ...state.gitMode, selectedEntryKey: nextSelectedEntryKey },
        gitPanel: {
          ...prev,
          ahead: next.ahead,
          behind: next.behind,
          branch: next.branch,
          error: null,
          files: sortedNext,
        },
      }
      return changedPaths.size === 0 ? base : clearDiffCacheForPaths(base, changedPaths)
    }
    case 'git-refresh-error': {
      const prev = state.gitPanel
      if (
        prev.error === action.kind &&
        prev.files.length === 0 &&
        state.gitMode.selectedEntryKey === null
      ) {
        return state
      }
      return {
        ...state,
        gitMode: { ...state.gitMode, pendingDeletePath: null, selectedEntryKey: null },
        gitPanel: { ...prev, error: action.kind, files: [] },
      }
    }
    case 'set-worktree-divergence': {
      if (sameDivergence(state.worktreeDivergence, action.divergence)) return state
      return { ...state, worktreeDivergence: action.divergence }
    }
    case 'git-panel-reset': {
      const prev = state.gitPanel
      if (
        prev.branch === null &&
        prev.error === null &&
        prev.files.length === 0 &&
        prev.ahead === 0 &&
        prev.behind === 0
      ) {
        return state
      }
      return {
        ...state,
        gitMode: { ...state.gitMode, pendingDeletePath: null, selectedEntryKey: null },
        gitPanel: emptyGitPanel(),
      }
    }
    default:
      return null
  }
}

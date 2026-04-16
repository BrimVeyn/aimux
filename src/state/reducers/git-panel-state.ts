import type { AppAction, AppState, GitFileEntry, GitFileSection, GitPanelState } from '../types'

export const GIT_PANEL_MIN_RATIO = 0.2
export const GIT_PANEL_MAX_RATIO = 0.8

const SECTION_RANK: Record<GitFileSection, number> = { staged: 0, unstaged: 1, untracked: 2 }

export function sortFilesBySection(files: GitFileEntry[]): GitFileEntry[] {
  return [...files].sort((a, b) => {
    const sa = SECTION_RANK[a.section]
    const sb = SECTION_RANK[b.section]
    if (sa !== sb) return sa - sb
    return a.path.localeCompare(b.path)
  })
}

function clampRatio(value: number): number {
  return Math.max(GIT_PANEL_MIN_RATIO, Math.min(GIT_PANEL_MAX_RATIO, value))
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
    case 'toggle-git-panel': {
      const nextGitVisible = !state.sidebar.gitPanelVisible
      const nextVisible = state.sidebar.visible || nextGitVisible
      return {
        ...state,
        sidebar: { ...state.sidebar, gitPanelVisible: nextGitVisible, visible: nextVisible },
      }
    }
    case 'resize-git-panel': {
      const nextRatio = clampRatio(state.sidebar.gitPanelRatio + action.delta)
      if (nextRatio === state.sidebar.gitPanelRatio) return state
      return { ...state, sidebar: { ...state.sidebar, gitPanelRatio: nextRatio } }
    }
    case 'git-refresh-success': {
      const prev = state.gitPanel
      const next = action.payload
      const sortedNext = sortFilesBySection(next.files)
      if (
        prev.branch === next.branch &&
        prev.ahead === next.ahead &&
        prev.behind === next.behind &&
        prev.error === null &&
        sameFiles(prev.files, sortedNext)
      ) {
        return state
      }
      return {
        ...state,
        gitPanel: {
          ...prev,
          ahead: next.ahead,
          behind: next.behind,
          branch: next.branch,
          error: null,
          files: sortedNext,
        },
      }
    }
    case 'git-refresh-error': {
      const prev = state.gitPanel
      if (prev.error === action.kind && prev.files.length === 0) return state
      return {
        ...state,
        gitPanel: { ...prev, error: action.kind, files: [] },
      }
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
      return { ...state, gitPanel: emptyGitPanel() }
    }
    default:
      return null
  }
}

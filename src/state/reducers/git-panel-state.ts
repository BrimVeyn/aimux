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
      const nextRatio = clampRatio(state.gitPane.ratio + action.delta)
      if (nextRatio === state.gitPane.ratio) return state
      return { ...state, gitPane: { ...state.gitPane, ratio: nextRatio } }
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

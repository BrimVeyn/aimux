import type { AppAction } from '../actions'
import type { AppState, AutoCommitState } from '../types'

function setByProject(
  state: AutoCommitState,
  projectId: string,
  next: AutoCommitState['byProject'][string]
): AutoCommitState {
  return { byProject: { ...state.byProject, [projectId]: next } }
}

export function reduceAutoCommitState(
  state: AutoCommitState,
  action: AppAction
): AutoCommitState | null {
  switch (action.type) {
    case 'auto-commit-generation-started': {
      return setByProject(state, action.projectId, {
        abortController: action.abortController,
        kind: 'generating',
        startedAt: action.startedAt,
        tabId: action.tabId,
        workingTreeHash: action.workingTreeHash,
      })
    }
    case 'auto-commit-generation-ready': {
      const current = state.byProject[action.projectId]
      if (!current || current.kind !== 'generating') return null
      if (current.workingTreeHash !== action.workingTreeHash) return null
      return setByProject(state, action.projectId, {
        body: action.body,
        generatedAt: action.generatedAt,
        kind: 'ready',
        tabId: current.tabId,
        title: action.title,
        workingTreeHash: current.workingTreeHash,
      })
    }
    case 'auto-commit-clear': {
      const current = state.byProject[action.projectId]
      if (!current || current.kind === 'idle') return null
      if (current.kind === 'generating') {
        try {
          current.abortController.abort()
        } catch {
          // ignore
        }
      }
      return setByProject(state, action.projectId, { kind: 'idle' })
    }
    default:
      return null
  }
}

export function reduceAutoCommit(state: AppState, action: AppAction): AppState | null {
  const next = reduceAutoCommitState(state.autoCommit, action)
  if (next === null) return null
  return { ...state, autoCommit: next }
}

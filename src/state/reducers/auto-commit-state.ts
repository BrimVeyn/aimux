import type { AppAction, AppState, AutoCommitState } from '../types'

function setBySession(
  state: AutoCommitState,
  sessionId: string,
  next: AutoCommitState['bySession'][string]
): AutoCommitState {
  return { bySession: { ...state.bySession, [sessionId]: next } }
}

export function reduceAutoCommitState(
  state: AutoCommitState,
  action: AppAction
): AutoCommitState | null {
  switch (action.type) {
    case 'auto-commit-generation-started': {
      return setBySession(state, action.sessionId, {
        abortController: action.abortController,
        kind: 'generating',
        startedAt: action.startedAt,
        tabId: action.tabId,
        workingTreeHash: action.workingTreeHash,
      })
    }
    case 'auto-commit-generation-ready': {
      const current = state.bySession[action.sessionId]
      if (!current || current.kind !== 'generating') return null
      if (current.workingTreeHash !== action.workingTreeHash) return null
      return setBySession(state, action.sessionId, {
        body: action.body,
        generatedAt: action.generatedAt,
        kind: 'ready',
        tabId: current.tabId,
        title: action.title,
        workingTreeHash: current.workingTreeHash,
      })
    }
    case 'auto-commit-clear':
    case 'auto-commit-dismiss':
    case 'auto-commit-accept': {
      const current = state.bySession[action.sessionId]
      if (!current || current.kind === 'idle') return null
      if (current.kind === 'generating') {
        try {
          current.abortController.abort()
        } catch {
          // ignore
        }
      }
      return setBySession(state, action.sessionId, { kind: 'idle' })
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

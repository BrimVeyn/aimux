import { type MutableRefObject, useEffect, useRef } from 'react'

import type { AppAction, AppState, GitRefreshPayload, TabActivity } from '../state/types'

import {
  type AutoCommitConfigSnapshot,
  type DriverDeps,
  onActivityTransition,
  onGitRefresh,
  onManualTrigger,
} from './auto-commit-driver'
import { setActiveAutoCommitDriver } from './auto-commit-ref'

interface Options {
  state: AppState
  stateRef: MutableRefObject<AppState>
  dispatch: (action: AppAction) => void
  config: AutoCommitConfigSnapshot
  getProfileConfigRoot: () => string
}

function gitPayloadFromState(state: AppState): GitRefreshPayload | null {
  const panel = state.gitPanel
  if (panel.error !== null) return null
  return {
    ahead: panel.ahead,
    behind: panel.behind,
    branch: panel.branch,
    files: panel.files,
  }
}

export function useAutoCommitDriver({
  config,
  dispatch,
  getProfileConfigRoot,
  state,
  stateRef,
}: Options): void {
  const configRef = useRef(config)
  configRef.current = config

  const deps: DriverDeps = {
    dispatch,
    getConfig: () => configRef.current,
    getProfileConfigRoot,
    getState: () => stateRef.current,
  }
  const depsRef = useRef(deps)
  depsRef.current = deps

  useEffect(() => {
    setActiveAutoCommitDriver((args) => onManualTrigger(depsRef.current, args))
    return () => setActiveAutoCommitDriver(null)
  }, [])

  const prevActivityRef = useRef<Map<string, TabActivity | undefined>>(new Map())

  useEffect(() => {
    const prev = prevActivityRef.current
    const next = new Map<string, TabActivity | undefined>()
    for (const tab of state.tabs) {
      next.set(tab.id, tab.activity)
      const before = prev.get(tab.id)
      const becameIdle =
        (before === 'working' || before === 'waiting-input') && tab.activity === 'idle'
      if (becameIdle) {
        const sessionId = state.currentSessionId
        if (!sessionId) continue
        const session = state.sessions.find((s) => s.id === sessionId)
        const git = gitPayloadFromState(state)
        void onActivityTransition(depsRef.current, {
          assistant: tab.assistant,
          git,
          projectPath: session?.projectPath,
          sessionId,
          tabId: tab.id,
        })
      }
    }
    prevActivityRef.current = next
  }, [state])

  const lastGitHashRef = useRef<string | null>(null)
  useEffect(() => {
    const sessionId = state.currentSessionId
    if (!sessionId) return
    const payload = gitPayloadFromState(state)
    if (!payload) return
    const cacheKey = JSON.stringify(payload)
    if (lastGitHashRef.current === cacheKey) return
    lastGitHashRef.current = cacheKey
    onGitRefresh(depsRef.current, sessionId, payload)
  }, [state])
}

import { type MutableRefObject, useEffect, useRef } from 'react'

import type { AppAction, AppState, GitRefreshPayload, TabActivity } from '../state/types'

import {
  type AutoCommitConfigSnapshot,
  type DriverDeps,
  onActivityTransition,
  onGitRefresh,
  onManualTrigger,
} from './auto-commit-driver'
import { clearActiveAutoCommitDriverIfMatches, setActiveAutoCommitDriver } from './auto-commit-ref'

interface Options {
  state: AppState
  stateRef: MutableRefObject<AppState>
  dispatch: (action: AppAction) => void
  config: AutoCommitConfigSnapshot
  getProfileConfigRoot: () => string
}

const GIT_STABILIZATION_DEBOUNCE_MS = 2000

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
    const handler: (args: Parameters<typeof onManualTrigger>[1]) => Promise<void> = (args) =>
      onManualTrigger(depsRef.current, args)
    setActiveAutoCommitDriver(handler)
    return () => clearActiveAutoCommitDriverIfMatches(handler)
  }, [])

  const prevActivityRef = useRef<Map<string, TabActivity | undefined>>(new Map())

  useEffect(() => {
    // Always refresh the activity map so re-enabling mid-session doesn't fire
    // a stale "became idle" transition. Skip only the dispatch work.
    const prev = prevActivityRef.current
    const next = new Map<string, TabActivity | undefined>()
    const enabled = configRef.current.enabled
    for (const tab of state.tabs) {
      next.set(tab.id, tab.activity)
      if (!enabled) continue
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
  const gitStabilizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!configRef.current.enabled) return
    const sessionId = state.currentSessionId
    if (!sessionId) return
    const payload = gitPayloadFromState(state)
    if (!payload) return
    const cacheKey = JSON.stringify(payload)
    if (lastGitHashRef.current === cacheKey) return
    lastGitHashRef.current = cacheKey
    onGitRefresh(depsRef.current, sessionId, payload)

    // Debounced trigger: when the working tree stays stable for
    // GIT_STABILIZATION_DEBOUNCE_MS, try to start generation. Covers cases
    // where the assistant's activity spinner never appears (e.g. Claude in
    // fast mode) and where the user edits via an external editor.
    if (gitStabilizeTimerRef.current) clearTimeout(gitStabilizeTimerRef.current)
    const activeTabId = state.activeTabId
    const activeTab = activeTabId ? state.tabs.find((tab) => tab.id === activeTabId) : undefined
    if (!activeTab) return
    const session = state.sessions.find((s) => s.id === sessionId)
    gitStabilizeTimerRef.current = setTimeout(() => {
      gitStabilizeTimerRef.current = null
      void onActivityTransition(depsRef.current, {
        assistant: activeTab.assistant,
        git: payload,
        projectPath: session?.projectPath,
        sessionId,
        tabId: activeTab.id,
      })
    }, GIT_STABILIZATION_DEBOUNCE_MS)
  }, [state])

  useEffect(
    () => () => {
      if (gitStabilizeTimerRef.current) clearTimeout(gitStabilizeTimerRef.current)
    },
    []
  )
}

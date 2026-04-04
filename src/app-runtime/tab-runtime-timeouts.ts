import { useCallback, useRef } from 'react'

import type { AppAction } from '../state/types'

export interface TabRuntimeTimeouts {
  clearIdleTimer: (tabId: string) => void
  clearStartupGrace: (tabId: string) => void
  startStartupGrace: (tabId: string, timeoutMs: number) => void
  isStartupGraceActive: (tabId: string) => boolean
  scheduleIdle: (tabId: string, timeoutMs: number) => void
  clearAllTimers: () => void
}

function clearTimeoutRegistry(timeouts: Map<string, ReturnType<typeof setTimeout>>): void {
  for (const timeout of timeouts.values()) {
    clearTimeout(timeout)
  }

  timeouts.clear()
}

export function useTabRuntimeTimeouts(dispatch: (action: AppAction) => void): TabRuntimeTimeouts {
  const idleTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const startupGraceTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const clearIdleTimer = useCallback((tabId: string): void => {
    const timeout = idleTimeoutsRef.current.get(tabId)
    if (!timeout) {
      return
    }

    clearTimeout(timeout)
    idleTimeoutsRef.current.delete(tabId)
  }, [])

  const clearStartupGrace = useCallback((tabId: string): void => {
    const timeout = startupGraceTimeoutsRef.current.get(tabId)
    if (!timeout) {
      return
    }

    clearTimeout(timeout)
    startupGraceTimeoutsRef.current.delete(tabId)
  }, [])

  const startStartupGrace = useCallback(
    (tabId: string, timeoutMs: number): void => {
      clearStartupGrace(tabId)
      const timeout = setTimeout(() => {
        startupGraceTimeoutsRef.current.delete(tabId)
      }, timeoutMs)
      startupGraceTimeoutsRef.current.set(tabId, timeout)
    },
    [clearStartupGrace]
  )

  const isStartupGraceActive = useCallback((tabId: string): boolean => {
    return startupGraceTimeoutsRef.current.has(tabId)
  }, [])

  const scheduleIdle = useCallback(
    (tabId: string, timeoutMs: number): void => {
      clearIdleTimer(tabId)
      const timeout = setTimeout(() => {
        dispatch({ activity: 'idle', tabId, type: 'set-tab-activity' })
        idleTimeoutsRef.current.delete(tabId)
      }, timeoutMs)
      idleTimeoutsRef.current.set(tabId, timeout)
    },
    [clearIdleTimer, dispatch]
  )

  const clearAllTimers = useCallback((): void => {
    clearTimeoutRegistry(idleTimeoutsRef.current)
    clearTimeoutRegistry(startupGraceTimeoutsRef.current)
  }, [])

  return {
    clearAllTimers,
    clearIdleTimer,
    clearStartupGrace,
    isStartupGraceActive,
    scheduleIdle,
    startStartupGrace,
  }
}

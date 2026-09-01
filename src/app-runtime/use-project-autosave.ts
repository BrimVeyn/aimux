import { useEffect, useRef } from 'react'

import type { AppState } from '../state/types'

import { saveCurrentProject } from '../state/project-save'

interface StartAutosaveOptions {
  debounceMs: number
  getState: () => AppState
  subscribe: (listener: () => void) => () => void
}

/**
 * Headless project autosave. Subscribes to the store and debounce-saves on
 * every change. Returns a disposer that flushes any pending save synchronously
 * (so the catalog is up-to-date when the host shuts down).
 *
 * Used by the GUI host, which has no React root.
 */
export function startProjectAutosave({
  debounceMs,
  getState,
  subscribe,
}: StartAutosaveOptions): () => void {
  let timeout: ReturnType<typeof setTimeout> | null = null

  const flush = (): void => {
    saveCurrentProject(getState())
  }

  const unsubscribe = subscribe(() => {
    if (timeout !== null) clearTimeout(timeout)
    timeout = setTimeout(() => {
      timeout = null
      flush()
    }, debounceMs)
  })

  return () => {
    unsubscribe()
    if (timeout !== null) {
      clearTimeout(timeout)
      timeout = null
    }
    flush()
  }
}

export function useProjectAutosave(state: AppState, debounceMs: number): void {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestStateRef = useRef(state)
  latestStateRef.current = state

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    timeoutRef.current = setTimeout(() => {
      saveCurrentProject(latestStateRef.current)
      timeoutRef.current = null
    }, debounceMs)

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [debounceMs, state])

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      saveCurrentProject(latestStateRef.current)
    }
  }, [])
}

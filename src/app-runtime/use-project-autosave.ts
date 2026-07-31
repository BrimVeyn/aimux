import { useEffect, useRef } from 'react'

import type { AppState } from '../state/types'

import { saveCurrentProject } from '../state/project-save'

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

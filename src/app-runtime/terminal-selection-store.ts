import { useSyncExternalStore } from 'react'

import type { CellRange } from '../input/terminal-selection'

/**
 * The one terminal selection on screen. Kept out of AppState: it changes on
 * every drag step, and only the pane that owns it needs to re-render.
 */
export interface TerminalSelection extends CellRange {
  tabId: string
}

let current: TerminalSelection | null = null
const listeners = new Set<() => void>()

export function setTerminalSelection(next: TerminalSelection | null): void {
  if (next === current) return
  current = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useTerminalSelection(tabId: string | undefined): TerminalSelection | null {
  return useSyncExternalStore(subscribe, () => (current?.tabId === tabId ? current : null))
}

import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import type { PrStatusResult } from '../git/pr-status'

export interface PrStatusState {
  result: PrStatusResult | null
  /** Last result seen per project path, so a workspace switch shows its own
   * previous state instead of blanking while the background fetch runs. */
  byPath: Record<string, PrStatusResult>
  /** True once a fetch failed but we are still showing the previous good result. */
  stale: boolean
  setResult: (path: string, result: PrStatusResult) => void
  /** Point the row at a project path, showing whatever we last knew about it. */
  selectPath: (path: string) => void
}

export const prStatusStore = createStore<PrStatusState>((set) => ({
  byPath: {},
  result: null,
  selectPath: (path: string) =>
    set((state) => ({ result: state.byPath[path] ?? null, stale: false })),
  setResult: (path: string, result: PrStatusResult) =>
    set((state) => {
      // A transient `gh` failure shouldn't blank a PR we already resolved — keep
      // the last good snapshot and mark it stale instead (same contract as
      // ai-usage-store's setSnapshot).
      if (result.kind === 'error' && state.result?.kind === 'ok') return { stale: true }
      return { byPath: { ...state.byPath, [path]: result }, result, stale: false }
    }),
  stale: false,
}))

/**
 * The PR state row only occupies its band once we know there is a PR — an
 * unknown or resolved-to-nothing state gives the row back. Shared so the header
 * and the row itself can never disagree and shift the layout under the user.
 */
export const selectPrRowVisible = (state: PrStatusState): boolean => state.result?.kind === 'ok'

export function usePrStatusStore<T>(selector: (state: PrStatusState) => T): T {
  return useStore(prStatusStore, selector)
}

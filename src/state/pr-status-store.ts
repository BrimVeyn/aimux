import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import type { PrStatusResult } from '../git/pr-status'

export interface PrStatusState {
  result: PrStatusResult | null
  /** True once a fetch failed but we are still showing the previous good result. */
  stale: boolean
  setResult: (result: PrStatusResult) => void
  reset: () => void
}

export const prStatusStore = createStore<PrStatusState>((set) => ({
  reset: () => set({ result: null, stale: false }),
  result: null,
  setResult: (result: PrStatusResult) =>
    set((state) => {
      // A transient `gh` failure shouldn't blank a PR we already resolved — keep
      // the last good snapshot and mark it stale instead (same contract as
      // ai-usage-store's setSnapshot).
      if (result.kind === 'error' && state.result?.kind === 'ok') return { stale: true }
      return { result, stale: false }
    }),
  stale: false,
}))

/**
 * The PR state row occupies its band both while the first fetch is in flight
 * and once it resolved to a PR — anything else (no PR, no gh, error) gives the
 * row back. Shared so the header and the row itself can never disagree and
 * shift the layout under the user.
 */
export const selectPrRowVisible = (state: PrStatusState): boolean =>
  state.result === null || state.result.kind === 'ok'

export function usePrStatusStore<T>(selector: (state: PrStatusState) => T): T {
  return useStore(prStatusStore, selector)
}

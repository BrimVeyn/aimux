import type { AIUsageTool } from '@brimveyn/aimux-config'

import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import type { UsageSnapshot } from '../services/ai-usage/types'

/**
 * What the poller has last seen, and nothing else. Whether the indicator is on
 * is not in here: that is the `aimux.ai-usage` plugin being loaded, which is
 * also what puts the tile in the status bar — two places saying it would only
 * let them disagree.
 */
export interface AIUsageState {
  snapshots: Partial<Record<AIUsageTool, UsageSnapshot>>
  setSnapshot: (snap: UsageSnapshot) => void
  clear: () => void
}

export const aiUsageStore = createStore<AIUsageState>((set) => ({
  clear: () => set({ snapshots: {} }),
  setSnapshot: (snap: UsageSnapshot) =>
    set((state) => {
      const prev = state.snapshots[snap.tool]
      const isFailure = Boolean(snap.error)
      const hasPriorValue = prev && prev.percent !== null
      const merged: UsageSnapshot =
        isFailure && hasPriorValue === true && prev != null
          ? { ...prev, error: snap.error, lastUpdated: snap.lastUpdated, stale: true }
          : snap
      return { snapshots: { ...state.snapshots, [snap.tool]: merged } }
    }),
  snapshots: {},
}))

export function useAIUsageStore<T>(selector: (state: AIUsageState) => T): T {
  return useStore(aiUsageStore, selector)
}

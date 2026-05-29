import type { AIUsageTool } from '@brimveyn/aimux-config'

import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import type { UsageSnapshot } from '../services/ai-usage/types'

export interface AIUsageState {
  enabled: boolean
  snapshots: Partial<Record<AIUsageTool, UsageSnapshot>>
  setEnabled: (enabled: boolean) => void
  setSnapshot: (snap: UsageSnapshot) => void
  clear: () => void
}

export const aiUsageStore = createStore<AIUsageState>((set) => ({
  clear: () => set({ snapshots: {} }),
  enabled: false,
  setEnabled: (enabled: boolean) => set({ enabled }),
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

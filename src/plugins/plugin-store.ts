import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import type { PluginRecord, PluginStatus } from './types'

/**
 * What the UI process knows about plugins, outside React.
 *
 * The settings screen builds its rows from a plain function of the projects —
 * deliberately, so a builder cannot depend on the whole app state — which
 * leaves it no way to reach `usePluginHost`'s return value. `app.tsx` was in
 * fact discarding it. This is the seam: the host publishes here, the sections
 * read here, and neither has to know about the other.
 *
 * Records rather than manifests, because a row has to show what a value
 * *resolved* to across every layer, not what the manifest declared.
 */

export interface PluginStoreState {
  records: readonly PluginRecord[]
  statuses: readonly PluginStatus[]
  /** Discovery problems, so a plugin that failed to load can say why. */
  issues: readonly { id?: string; message: string }[]
  /** Bumped on every publish; what a memo keyed on the store watches. */
  revision: number
}

export const pluginStore = createStore<PluginStoreState>(() => ({
  issues: [],
  records: [],
  revision: 0,
  statuses: [],
}))

export function usePluginStore<T>(selector: (state: PluginStoreState) => T): T {
  return useStore(pluginStore, selector)
}

export function publishPluginRecords(
  records: readonly PluginRecord[],
  issues: readonly { id?: string; message: string }[]
): void {
  pluginStore.setState((state) => ({ issues, records, revision: state.revision + 1 }))
}

export function publishPluginStatuses(statuses: readonly PluginStatus[]): void {
  pluginStore.setState((state) => ({ revision: state.revision + 1, statuses }))
}

/** Every host's state for one plugin, worst first — what a row shows. */
export function pluginStateSummary(id: string): 'active' | 'failed' | 'pending' | 'not-running' {
  const mine = pluginStore.getState().statuses.filter((status) => status.id === id)
  if (mine.length === 0) return 'not-running'
  if (mine.some((status) => status.state === 'failed')) return 'failed'
  if (mine.some((status) => status.state === 'pending')) return 'pending'
  return mine.some((status) => status.state === 'active') ? 'active' : 'not-running'
}

export function pluginError(id: string): string | undefined {
  return pluginStore.getState().statuses.find((s) => s.id === id && s.error !== undefined)?.error
}

/** Test seam. Never called by the app. */
export function clearPluginStore(): void {
  pluginStore.setState({ issues: [], records: [], revision: 0, statuses: [] })
}

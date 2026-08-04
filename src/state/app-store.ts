import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import type { AppAction } from './actions'
import type { AppState } from './types'

import { countAction } from '../services/aimux-counters/observe'
import { appReducer, createInitialState } from './store'

export interface AppStore extends AppState {
  dispatch: (action: AppAction) => void
}

export const appStore = createStore<AppStore>((set) => ({
  ...createInitialState(),
  // Counting happens here rather than inside the reducers, which stay pure —
  // and after the reducer, on the outcome rather than the intent: an `add-tab`
  // or a `split-pane` the reducer declines is not a tab or a split, and
  // counting it would report something that never happened.
  dispatch: (action: AppAction) => {
    set((state) => {
      const next = appReducer(state, action)
      if (next !== state) countAction(action)
      return next
    })
  },
}))

export function useAppStore<T>(selector: (state: AppStore) => T): T {
  return useStore(appStore, selector)
}

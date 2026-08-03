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
  // Counting happens here rather than inside the reducers, which stay pure.
  dispatch: (action: AppAction) => {
    countAction(action)
    set((state) => appReducer(state, action))
  },
}))

export function useAppStore<T>(selector: (state: AppStore) => T): T {
  return useStore(appStore, selector)
}

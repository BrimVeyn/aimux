import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import type { AppAction, AppState } from './types'

import { appReducer, createInitialState } from './store'

export interface AppStore extends AppState {
  dispatch: (action: AppAction) => void
}

export const appStore = createStore<AppStore>((set) => ({
  ...createInitialState(),
  dispatch: (action: AppAction) => set((state) => appReducer(state, action)),
}))

export function useAppStore<T>(selector: (state: AppStore) => T): T {
  return useStore(appStore, selector)
}

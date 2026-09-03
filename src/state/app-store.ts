import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import type { AppAction } from './actions'
import type { AppState } from './types'

import { emitAppEvent } from '../app-runtime/app-events'
import { appReducer, createInitialState } from './store'

export interface AppStore extends AppState {
  dispatch: (action: AppAction) => void
}

export const appStore = createStore<AppStore>((set) => ({
  ...createInitialState(),
  // Observation happens here rather than inside the reducers, which stay pure —
  // and on the outcome rather than the intent: an `add-tab` or a `split-pane`
  // the reducer declines is not a tab or a split, and reporting it would
  // describe something that never happened. Outside the `set` updater, which
  // has to stay a pure function of the state it is handed.
  dispatch: (action: AppAction) => {
    const before = appStore.getState()
    const after = appReducer(before, action)
    if (after !== before) emitAppEvent('action', { action, after, before })
    set(after)
  },
}))

export function useAppStore<T>(selector: (state: AppStore) => T): T {
  return useStore(appStore, selector)
}

import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import { type Theme, type ThemeId, THEMES } from './themes'

interface ThemeStore {
  theme: Theme
}

const DEFAULT = THEMES['aimux']
if (!DEFAULT) throw new Error('default theme missing')

const themeStore = createStore<ThemeStore>(() => ({ theme: DEFAULT }))

/**
 * Subscribe to the active theme. Pass a selector to subscribe to a narrower
 * slice (`useTheme(t => t.colors['editor.foreground'])`) or call with no
 * arguments to get the whole theme.
 */
export function useTheme(): Theme
export function useTheme<T>(selector: (theme: Theme) => T): T
export function useTheme<T>(selector?: (theme: Theme) => T): T | Theme {
  return useStore(themeStore, (s) => (selector ? selector(s.theme) : s.theme))
}

/** Synchronous snapshot for non-React callers (reducers, side effects). */
export function getCurrentTheme(): Theme {
  return themeStore.getState().theme
}

/** Swap the active theme. Triggers re-renders on every `useTheme` subscriber. */
export function applyTheme(id: ThemeId): void {
  const entry = THEMES[id]
  if (!entry) return
  themeStore.setState({ theme: entry })
}

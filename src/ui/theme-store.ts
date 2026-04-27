import {
  migrateThemeId,
  type ResolvedTuiTheme,
  resolveTuiTheme,
  type ThemeId,
  type ThemeMode,
  TUI_THEMES,
} from '@brimveyn/aimux-config'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

const DEFAULT_ID: ThemeId = 'aimux'

interface ThemeStore {
  id: ThemeId
  mode: ThemeMode
  transparent: boolean
}

const themeStore = createStore<ThemeStore>(() => ({
  id: DEFAULT_ID,
  mode: 'dark',
  transparent: false,
}))

let cachedId: ThemeId | null = null
let cachedMode: ThemeMode | null = null
let cachedResolved: ResolvedTuiTheme | null = null

function derive(id: ThemeId, mode: ThemeMode): ResolvedTuiTheme {
  if (cachedResolved && cachedId === id && cachedMode === mode) return cachedResolved
  cachedId = id
  cachedMode = mode
  const json = TUI_THEMES[id] ?? TUI_THEMES.aimux
  if (!json) throw new Error(`No theme JSON for ${id}`)
  cachedResolved = resolveTuiTheme(json, mode)
  return cachedResolved
}

/** Subscribe to the resolved TUI theme for the active id+mode. */
export function useTheme(): ResolvedTuiTheme {
  return useStore(themeStore, (s) => derive(s.id, s.mode))
}

/** Synchronous snapshot of the resolved theme for non-React callers. */
export function getCurrentTheme(): ResolvedTuiTheme {
  const s = themeStore.getState()
  return derive(s.id, s.mode)
}

export function getCurrentThemeId(): ThemeId {
  return themeStore.getState().id
}

export function getCurrentMode(): ThemeMode {
  return themeStore.getState().mode
}

/** Swap the active theme by id. Falls back via migrateThemeId for legacy ids. */
export function applyTheme(id: string): void {
  const next = migrateThemeId(id)
  if (themeStore.getState().id === next) return
  themeStore.setState({ id: next })
}

/** Toggle between dark and light. Plumbed but not yet wired to UI controls. */
export function setMode(mode: ThemeMode): void {
  if (themeStore.getState().mode === mode) return
  themeStore.setState({ mode })
}

export function useTransparent(): boolean {
  return useStore(themeStore, (s) => s.transparent)
}

export function useMode(): ThemeMode {
  return useStore(themeStore, (s) => s.mode)
}

export function getTransparent(): boolean {
  return themeStore.getState().transparent
}

export function setTransparent(value: boolean): void {
  if (themeStore.getState().transparent === value) return
  themeStore.setState({ transparent: value })
}

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
let cachedBase: ResolvedTuiTheme | null = null
let cachedTransparent: boolean | null = null
let cachedFinal: ResolvedTuiTheme | null = null

// Chrome surface tokens: when transparent mode is on we replace these with
// 'transparent' so opentui's BoxRenderable skips its fill (alpha=0 early-returns
// in setCellWithAlphaBlending) and the host terminal background shows through
// every chrome site (root, sidebar, tabs, status bar, modals, …) without
// patching ~30 components one-by-one.
const CHROME_BG_TOKENS = [
  'background',
  'backgroundPanel',
  'backgroundElement',
  'backgroundMenu',
] as const

function derive(id: ThemeId, mode: ThemeMode, transparent: boolean): ResolvedTuiTheme {
  if (cachedFinal && cachedId === id && cachedMode === mode && cachedTransparent === transparent)
    return cachedFinal

  if (!cachedBase || cachedId !== id || cachedMode !== mode) {
    const json = TUI_THEMES[id] ?? TUI_THEMES.aimux
    if (!json) throw new Error(`No theme JSON for ${id}`)
    cachedBase = resolveTuiTheme(json, mode)
  }
  cachedId = id
  cachedMode = mode
  cachedTransparent = transparent

  if (transparent) {
    const overlay: ResolvedTuiTheme = { ...cachedBase }
    for (const key of CHROME_BG_TOKENS) overlay[key] = 'transparent'
    cachedFinal = overlay
  } else {
    cachedFinal = cachedBase
  }
  return cachedFinal
}

/** Subscribe to the resolved TUI theme for the active id+mode (+transparent overlay). */
export function useTheme(): ResolvedTuiTheme {
  return useStore(themeStore, (s) => derive(s.id, s.mode, s.transparent))
}

/** Synchronous snapshot of the resolved theme for non-React callers. */
export function getCurrentTheme(): ResolvedTuiTheme {
  const s = themeStore.getState()
  return derive(s.id, s.mode, s.transparent)
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

/** Subscribe to theme id/mode changes for non-React side-effects. */
export function subscribeThemeChanges(
  listener: (resolved: ResolvedTuiTheme, mode: ThemeMode) => void
): () => void {
  let lastId: ThemeId | null = null
  let lastMode: ThemeMode | null = null
  return themeStore.subscribe((s) => {
    if (s.id === lastId && s.mode === lastMode) return
    lastId = s.id
    lastMode = s.mode
    // Pass base theme (transparent=false): the only subscriber today is the
    // Claude Code theme bridge, which has no transparency concept and wants
    // the resolved palette.
    listener(derive(s.id, s.mode, false), s.mode)
  })
}

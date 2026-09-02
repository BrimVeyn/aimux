import {
  getTuiTheme,
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
let cachedOverlay: ResolvedTuiTheme | null = null

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

// Both the opaque base and the transparent overlay are cached side-by-side
// (both keyed by id+mode). A single-slot cache would thrash when useTheme() and
// useBaseTheme() are both mounted with different transparent values — each call
// would invalidate the other's cache, hand React a fresh object reference every
// render, and drive an infinite update loop.
function derive(id: ThemeId, mode: ThemeMode, transparent: boolean): ResolvedTuiTheme {
  if (!cachedBase || cachedId !== id || cachedMode !== mode) {
    const json = getTuiTheme(id) ?? TUI_THEMES.aimux
    if (!json) throw new Error(`No theme JSON for ${id}`)
    cachedBase = resolveTuiTheme(json, mode)
    cachedOverlay = null
    cachedId = id
    cachedMode = mode
  }
  if (!transparent) return cachedBase
  if (!cachedOverlay) {
    const overlay: ResolvedTuiTheme = { ...cachedBase }
    for (const key of CHROME_BG_TOKENS) overlay[key] = 'transparent'
    cachedOverlay = overlay
  }
  return cachedOverlay
}

/** Subscribe to the resolved TUI theme for the active id+mode (+transparent overlay). */
export function useTheme(): ResolvedTuiTheme {
  return useStore(themeStore, (s) => derive(s.id, s.mode, s.transparent))
}

/**
 * Resolved TUI theme WITHOUT the transparent chrome overlay. Use for the rare
 * chrome sites that must stay opaque even in transparent mode — e.g. the
 * sidebar selection highlight (would otherwise vanish) and the status-bar
 * badge foregrounds (would otherwise render as transparent-on-color).
 */
export function useBaseTheme(): ResolvedTuiTheme {
  return useStore(themeStore, (s) => derive(s.id, s.mode, false))
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

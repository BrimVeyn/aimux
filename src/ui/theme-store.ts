import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import {
  type AimuxPalette,
  type AimuxTheme,
  extendPalette,
  type ResolvedTokens,
  resolveTheme,
  type ThemeId,
  type ThemeMode,
  THEMES,
  type ThemeVariantOverrides,
} from './themes'

// Memoize `resolveTheme(palette, mode, overrides)` by identity so
// `useStore` selectors return stable references across renders.
let cachedPalette: AimuxPalette | null = null
let cachedMode: ThemeMode | null = null
let cachedOverrides: AimuxTheme['overrides'] | null = null
let cachedResolved: ResolvedTokens | null = null

function deriveResolved(theme: AimuxTheme): ResolvedTokens {
  if (
    cachedPalette === theme.palette &&
    cachedMode === theme.mode &&
    cachedOverrides === theme.overrides &&
    cachedResolved
  ) {
    return cachedResolved
  }
  cachedPalette = theme.palette
  cachedMode = theme.mode
  cachedOverrides = theme.overrides
  cachedResolved = resolveTheme(
    theme.palette,
    theme.mode,
    theme.overrides as ThemeVariantOverrides | undefined
  )
  return cachedResolved
}

interface ThemeStore {
  theme: AimuxTheme
  transparent: boolean
}

const DEFAULT = THEMES['aimux-dark']
if (!DEFAULT) throw new Error('default theme missing')

const themeStore = createStore<ThemeStore>(() => ({ theme: DEFAULT, transparent: false }))

/** Subscribe to the full opencode-resolved token map for the active theme. */
export function useTheme(): ResolvedTokens {
  return useStore(themeStore, (s) => deriveResolved(s.theme))
}

/** Synchronous snapshot of the resolved token map for non-React callers. */
export function getCurrentResolved(): ResolvedTokens {
  return deriveResolved(themeStore.getState().theme)
}

/** Synchronous snapshot of the raw palette for non-React callers. */
export function getCurrentPalette(): AimuxPalette {
  return themeStore.getState().theme.palette
}

/** Synchronous snapshot of the full theme object for non-React callers. */
export function getCurrentTheme(): AimuxTheme {
  return themeStore.getState().theme
}

/** Swap the active theme by id, optionally merging palette overrides. */
export function applyTheme(id: ThemeId, paletteOverrides?: Partial<AimuxPalette>): void {
  const entry = THEMES[id]
  if (!entry) return
  const palette = extendPalette(entry.palette, paletteOverrides)
  const merged: AimuxTheme = {
    ...entry,
    bg: palette.neutral,
    fg: palette.ink,
    palette,
  }
  themeStore.setState({ theme: merged })
}

/** Subscribe to the transparent-mode flag. */
export function useTransparent(): boolean {
  return useStore(themeStore, (s) => s.transparent)
}

export function getTransparent(): boolean {
  return themeStore.getState().transparent
}

export function setTransparent(value: boolean): void {
  if (themeStore.getState().transparent === value) return
  themeStore.setState({ transparent: value })
}

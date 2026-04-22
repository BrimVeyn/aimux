import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import {
  accent,
  type AimuxPalette,
  type AimuxTheme,
  computeSurfaces,
  diffAddBg,
  diffDeleteBg,
  extendPalette,
  type ThemeId,
  type ThemeMode,
  THEMES,
} from './themes'

export interface ThemeTokens {
  /** `accent` with `primary` fallback. */
  accent: string
  /** App-level background surface (derived from palette.neutral seed via OKLCH). */
  bg: string
  /** Subtle border between panels. */
  border: string
  /** Background tint for inserted diff lines. */
  diffAddBg: string
  /** Background tint for removed diff lines. */
  diffDeleteBg: string
  /** Surface a notch above the base background — sidebars, headers. */
  elevated: string
  /** Fainter still — line numbers, placeholders, disabled. */
  faint: string
  /** Hover/highlight surface (line highlight, list hover). */
  hover: string
  /** Half-way between background and ink — labels, captions, paths. */
  muted: string
  palette: AimuxPalette
  /** Selected/active row surface. */
  selected: string
}

function computeTokens(palette: AimuxPalette, mode: ThemeMode): ThemeTokens {
  const surfaces = computeSurfaces(palette, mode)
  return {
    accent: accent(palette),
    bg: surfaces.bg,
    border: surfaces.border,
    diffAddBg: diffAddBg(palette),
    diffDeleteBg: diffDeleteBg(palette),
    elevated: surfaces.elevated,
    faint: surfaces.faint,
    hover: surfaces.hover,
    muted: surfaces.muted,
    palette,
    selected: surfaces.selected,
  }
}

// Memoize by (palette, mode) so `useStore` selectors return stable objects.
let cachedPalette: AimuxPalette | null = null
let cachedMode: ThemeMode | null = null
let cachedTokens: ThemeTokens | null = null

function deriveTokens(palette: AimuxPalette, mode: ThemeMode): ThemeTokens {
  if (cachedPalette === palette && cachedMode === mode && cachedTokens) return cachedTokens
  cachedPalette = palette
  cachedMode = mode
  cachedTokens = computeTokens(palette, mode)
  return cachedTokens
}

interface ThemeStore {
  theme: AimuxTheme
  transparent: boolean
}

const DEFAULT = THEMES['aimux-dark']
if (!DEFAULT) throw new Error('default theme missing')

const themeStore = createStore<ThemeStore>(() => ({ theme: DEFAULT, transparent: false }))

/** Subscribe to the active palette plus precomputed derived shades. */
export function useTokens(): ThemeTokens {
  return useStore(themeStore, (s) => deriveTokens(s.theme.palette, s.theme.mode))
}

/** Synchronous tokens for non-React callers. */
export function getCurrentTokens(): ThemeTokens {
  const s = themeStore.getState()
  return deriveTokens(s.theme.palette, s.theme.mode)
}

/** Synchronous snapshot for non-React callers (reducers, side effects). */
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

export type SurfaceToken = 'base' | 'elevated' | 'hover' | 'selected' | 'border'

function resolveSurface(palette: AimuxPalette, mode: ThemeMode, token: SurfaceToken): string {
  const surfaces = computeSurfaces(palette, mode)
  switch (token) {
    case 'base':
      return surfaces.bg
    case 'elevated':
      return surfaces.elevated
    case 'hover':
      return surfaces.hover
    case 'selected':
      return surfaces.selected
    case 'border':
      return surfaces.border
  }
}

/**
 * Resolve a surface color through the transparent-mode flag. Returns
 * `undefined` for the base surface when transparent mode is on, letting the
 * terminal emulator's own background show through.
 */
export function useBg(token: SurfaceToken): string | undefined {
  return useStore(themeStore, (s) => {
    if (s.transparent && token === 'base') return undefined
    return resolveSurface(s.theme.palette, s.theme.mode, token)
  })
}

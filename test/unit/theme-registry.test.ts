import {
  computeSurfaces,
  extendPalette,
  isKnownThemeId,
  migrateThemeId,
  paletteToShikiTheme,
  resolveTheme,
  THEME_IDS,
  THEMES,
} from '@brimveyn/aimux-config'
import { describe, expect, test } from 'bun:test'

import { hexToOklch, hexToRgb } from '../../packages/aimux-config/src/oklch'
import { filterThemeIds } from '../../src/ui/filter-themes'

function isHexOrColorRef(value: string): boolean {
  return value.startsWith('#') || value.startsWith('rgba(') || value.startsWith('var(')
}

function relativeLuminance(hex: string): number {
  const { b, g, r } = hexToRgb(hex)
  const lift = (v: number): number =>
    v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  return 0.2126 * lift(r) + 0.7152 * lift(g) + 0.0722 * lift(b)
}

function contrastRatio(a: string, b: string): number {
  const x = relativeLuminance(a)
  const y = relativeLuminance(b)
  const light = Math.max(x, y)
  const dark = Math.min(x, y)
  return (light + 0.05) / (dark + 0.05)
}

function requireTheme(id: string) {
  const t = THEMES[id]
  if (!t) throw new Error(`theme ${id} missing`)
  return t
}

type RequiredPaletteKey = 'neutral' | 'ink' | 'primary' | 'success' | 'warning' | 'error' | 'info'
const REQUIRED_KEYS: RequiredPaletteKey[] = [
  'neutral',
  'ink',
  'primary',
  'success',
  'warning',
  'error',
  'info',
]

describe('THEMES registry', () => {
  test('ships the aimux house theme + the opencode catalog', () => {
    expect(isKnownThemeId('aimux-dark')).toBe(true)
    expect(isKnownThemeId('aimux-light')).toBe(true)
    // House themes lead the list, opencode follows.
    expect(THEME_IDS.slice(0, 2)).toEqual(['aimux-dark', 'aimux-light'])
    expect(THEME_IDS.length).toBeGreaterThan(60)
    // Spot-check a couple of opencode entries.
    expect(isKnownThemeId('dracula-dark')).toBe(true)
    expect(isKnownThemeId('tokyonight-light')).toBe(true)
  })

  test('every required palette token is populated on each variant', () => {
    for (const id of THEME_IDS) {
      const palette = requireTheme(id).palette
      for (const key of REQUIRED_KEYS) {
        const value = palette[key]
        expect(typeof value).toBe('string')
        expect(value.startsWith('#')).toBe(true)
      }
    }
  })
})

describe('computed bg luminance', () => {
  // Main regression guard: make sure no imported theme ends up with a bg
  // that's visibly wrong for its mode (e.g. a light theme rendering
  // Windows-XP grey, or a dark theme rendering washed-out mid-grey).
  // AMOLED dark legitimately resolves to L=0 and pure-white light themes
  // approach L=1, so the tight side is only checked against the wrong end.
  test('every theme resolves bg inside its mode window', () => {
    for (const id of THEME_IDS) {
      const theme = requireTheme(id)
      const surfaces = computeSurfaces(theme.palette, theme.mode)
      const { l } = hexToOklch(surfaces.bg)
      if (theme.mode === 'dark') {
        expect(l).toBeGreaterThanOrEqual(0)
        expect(l).toBeLessThan(0.3)
      } else {
        expect(l).toBeGreaterThan(0.86)
        expect(l).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('resolveTheme — registry-wide sweep', () => {
  test('every theme yields valid token values for every key', () => {
    for (const id of THEME_IDS) {
      const theme = requireTheme(id)
      const tokens = resolveTheme(theme.palette, theme.mode, theme.overrides)
      for (const [key, value] of Object.entries(tokens)) {
        if (!isHexOrColorRef(value)) {
          throw new Error(`${id}: token "${key}" has unsupported value: ${JSON.stringify(value)}`)
        }
      }
    }
  })

  // Catppuccin's "frappe-light" / "macchiato-light" upstream variants force a
  // dark palette into light mode and yield real-world contrast around 2:1.
  // They're 1:1 with opencode and intentional, not a regression in our port.
  const KNOWN_LOW_CONTRAST = new Set(['catppuccin-frappe-light', 'catppuccin-macchiato-light'])

  test('text-base vs background-base passes WCAG AA contrast (≥4.5) on every theme except known-low upstream entries', () => {
    for (const id of THEME_IDS) {
      if (KNOWN_LOW_CONTRAST.has(id)) continue
      const theme = requireTheme(id)
      const tokens = resolveTheme(theme.palette, theme.mode, theme.overrides)
      const fg = tokens['text-base']
      const bg = tokens['background-base']
      if (!fg.startsWith('#') || !bg.startsWith('#')) continue
      const ratio = contrastRatio(fg, bg)
      if (ratio < 4.5) {
        throw new Error(`${id}: text-base/background-base contrast is ${ratio.toFixed(2)} (<4.5)`)
      }
    }
  })

  test('background-base luminance lands in the per-mode window', () => {
    for (const id of THEME_IDS) {
      const theme = requireTheme(id)
      const tokens = resolveTheme(theme.palette, theme.mode, theme.overrides)
      const bg = tokens['background-base']
      if (!bg.startsWith('#')) continue
      const { l } = hexToOklch(bg)
      if (theme.mode === 'dark') {
        expect(l).toBeGreaterThanOrEqual(0)
        expect(l).toBeLessThan(0.3)
      } else {
        expect(l).toBeGreaterThan(0.86)
        expect(l).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('migrateThemeId', () => {
  test('passes new ids through', () => {
    expect(migrateThemeId('aimux-dark')).toBe('aimux-dark')
    expect(migrateThemeId('aimux-light')).toBe('aimux-light')
  })

  test('maps legacy "aimux" id to the dark variant', () => {
    expect(migrateThemeId('aimux')).toBe('aimux-dark')
  })

  test('falls back to aimux-dark for unknown input', () => {
    expect(migrateThemeId(undefined)).toBe('aimux-dark')
    expect(migrateThemeId('dracula')).toBe('aimux-dark')
  })
})

describe('extendPalette', () => {
  test('returns the base palette when overrides is undefined', () => {
    const base = requireTheme('aimux-dark').palette
    expect(extendPalette(base, undefined)).toBe(base)
  })

  test('overrides selectively without losing other tokens', () => {
    const base = requireTheme('aimux-dark').palette
    const merged = extendPalette(base, { primary: '#ff00aa' })
    expect(merged.primary).toBe('#ff00aa')
    expect(merged.neutral).toBe(base.neutral)
    expect(merged.ink).toBe(base.ink)
  })
})

describe('paletteToShikiTheme', () => {
  test('produces a shiki theme matching the active palette mode/colors', () => {
    const dark = requireTheme('aimux-dark')
    const out = paletteToShikiTheme({ mode: dark.mode, name: 'aimux-dark', palette: dark.palette })
    expect(out.name).toBe('aimux-dark')
    expect(out.type).toBe('dark')
    expect(out.bg).toBe(dark.palette.neutral)
    expect(out.fg).toBe(dark.palette.ink)
    expect(out.colors?.['editor.background']).toBe(dark.palette.neutral)
    expect((out.settings ?? []).length).toBeGreaterThan(5)
  })
})

describe('filterThemeIds', () => {
  test('null/empty filter returns the full list', () => {
    expect(filterThemeIds(null).length).toBe(THEME_IDS.length)
    expect(filterThemeIds('').length).toBe(THEME_IDS.length)
  })

  test('matches against the theme id', () => {
    expect(filterThemeIds('dark')).toContain('aimux-dark')
    expect(filterThemeIds('light')).toContain('aimux-light')
  })

  test('returns empty for no matches', () => {
    expect(filterThemeIds('zzz-does-not-exist')).toEqual([])
  })
})

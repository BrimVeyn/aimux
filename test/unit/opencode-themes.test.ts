import {
  OPENCODE_THEME_IDS,
  OPENCODE_THEMES,
  paletteToShikiTheme,
  resolveTheme,
} from '@brimveyn/aimux-config'
import { describe, expect, test } from 'bun:test'

const REQUIRED_KEYS = ['neutral', 'ink', 'primary', 'success', 'warning', 'error', 'info'] as const
const HEX_RE = /^#[0-9a-f]{6}$/

describe('opencode theme catalog', () => {
  test('imports a substantial catalog (>= 60 variants)', () => {
    expect(OPENCODE_THEME_IDS.length).toBeGreaterThanOrEqual(60)
  })

  test('every variant exposes all required palette tokens as #rrggbb', () => {
    for (const id of OPENCODE_THEME_IDS) {
      const theme = OPENCODE_THEMES[id]
      if (!theme) throw new Error(`missing ${id}`)
      expect(theme.mode === 'dark' || theme.mode === 'light').toBe(true)
      for (const key of REQUIRED_KEYS) {
        const value = theme.palette[key]
        expect(typeof value, `${id}.${key} not string`).toBe('string')
        expect(HEX_RE.test(value), `${id}.${key} not #rrggbb (got ${value})`).toBe(true)
      }
      expect(theme.fg).toBe(theme.palette.ink)
      expect(theme.bg).toBe(theme.palette.neutral)
    }
  })

  test('paletteToShikiTheme accepts every variant without throwing', () => {
    for (const id of OPENCODE_THEME_IDS) {
      const theme = OPENCODE_THEMES[id]
      if (!theme) throw new Error(`missing ${id}`)
      const tokens = resolveTheme(theme.palette, theme.mode, theme.overrides as never)
      expect(() => paletteToShikiTheme({ mode: theme.mode, name: id, tokens })).not.toThrow()
    }
  })

  test('every id ends with -light or -dark', () => {
    for (const id of OPENCODE_THEME_IDS) {
      expect(id.endsWith('-light') || id.endsWith('-dark'), `bad id: ${id}`).toBe(true)
    }
  })
})

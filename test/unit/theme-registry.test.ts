import {
  AIMUX_COLOR_KEYS,
  isKnownThemeId,
  migrateThemeId,
  normalizeTheme,
  registerUserThemes,
  type Theme,
  THEME_IDS,
  THEMES,
  themes,
} from '@brimveyn/aimux-config'
import { describe, expect, test } from 'bun:test'

import { filterThemeIds } from '../../src/ui/filter-themes'

function requireTheme(id: string): Theme {
  const t = THEMES[id]
  if (!t) throw new Error(`theme ${id} missing`)
  return t
}

describe('normalizeTheme', () => {
  test('fills every AIMUX_COLOR_KEY from a minimal input', () => {
    const out = normalizeTheme({
      bg: '#101010',
      colors: {},
      fg: '#eeeeee',
      name: 't',
      type: 'dark',
    })
    for (const key of AIMUX_COLOR_KEYS) {
      expect(typeof out.colors[key]).toBe('string')
      expect(out.colors[key].startsWith('#')).toBe(true)
    }
  })

  test('prefers explicit colors over fallbacks', () => {
    const out = normalizeTheme({
      colors: {
        'editor.background': '#112233',
        'textLink.foreground': '#abcdef',
      },
      name: 't',
    })
    expect(out.colors['editor.background']).toBe('#112233')
    expect(out.colors['textLink.foreground']).toBe('#abcdef')
    // focusBorder falls back to textLink.foreground
    expect(out.colors['focusBorder']).toBe('#abcdef')
  })

  test('strips alpha channel from 8-digit hex values', () => {
    const out = normalizeTheme({
      colors: { 'editor.background': '#112233ff' },
      name: 't',
    })
    expect(out.colors['editor.background']).toBe('#112233')
  })

  test('preserves extra keys outside AIMUX_COLOR_KEYS', () => {
    const out = normalizeTheme({
      colors: { 'custom.workbenchKey': '#beefed', 'editor.background': '#000' },
      name: 't',
    })
    expect(out.colors['custom.workbenchKey']).toBe('#beefed')
  })

  test('defaults settings to an empty array', () => {
    const out = normalizeTheme({ name: 't' })
    expect(out.settings).toEqual([])
  })
})

describe('THEMES registry', () => {
  test('ships aimux and dracula-at-night as house themes', () => {
    expect(isKnownThemeId('aimux')).toBe(true)
    expect(isKnownThemeId('dracula-at-night')).toBe(true)
    expect(requireTheme('aimux').displayName).toBe('Aimux')
    expect(requireTheme('dracula-at-night').displayName).toBe('Dracula At Night')
  })

  test('every shipped theme has the full AIMUX_COLOR_KEYS set', () => {
    for (const id of THEME_IDS) {
      const theme = THEMES[id]
      expect(theme).toBeDefined()
      if (!theme) continue
      for (const key of AIMUX_COLOR_KEYS) {
        expect(typeof theme.colors[key]).toBe('string')
      }
    }
  })

  test('ships > 60 themes (shiki catalog + house)', () => {
    expect(THEME_IDS.length).toBeGreaterThan(60)
  })
})

describe('registerUserThemes', () => {
  const cleanup: string[] = []
  function cleanupRegistered() {
    for (const id of cleanup) {
      delete THEMES[id]
      const idx = THEME_IDS.indexOf(id)
      if (idx >= 0) THEME_IDS.splice(idx, 1)
    }
    cleanup.length = 0
  }

  test('full theme is normalized even if user omits keys', () => {
    const id = 'test-full-minimal'
    cleanup.push(id)
    try {
      registerUserThemes({
        [id]: themes.full({
          bg: '#0a0a0a',
          colors: { 'editor.background': '#0a0a0a', 'editor.foreground': '#ffffff' },
          displayName: 'Full minimal',
          fg: '#ffffff',
          name: id,
          settings: [],
          type: 'dark',
        }),
      })
      const out = THEMES[id]
      if (!out) throw new Error('theme missing')
      for (const key of AIMUX_COLOR_KEYS) {
        expect(typeof out.colors[key]).toBe('string')
      }
    } finally {
      cleanupRegistered()
    }
  })

  test('define(name, base, overrides) inherits from base and applies overrides', () => {
    const id = 'test-define'
    cleanup.push(id)
    try {
      registerUserThemes({
        [id]: themes.define(id, 'aimux', {
          'textLink.foreground': '#ff00aa',
        }),
      })
      const out = THEMES[id]
      if (!out) throw new Error('theme missing')
      expect(out.colors['textLink.foreground']).toBe('#ff00aa')
      // inherited from aimux
      expect(out.colors['editor.background']).toBe(
        requireTheme('aimux').colors['editor.background']
      )
      expect(out.displayName).toBe(id)
    } finally {
      cleanupRegistered()
    }
  })

  test('define dedupes registration — re-registering does not duplicate THEME_IDS', () => {
    const id = 'test-dedupe'
    cleanup.push(id)
    try {
      registerUserThemes({ [id]: themes.define(id, 'aimux', {}) })
      registerUserThemes({ [id]: themes.define(id, 'aimux', {}) })
      expect(THEME_IDS.filter((x) => x === id).length).toBe(1)
    } finally {
      cleanupRegistered()
    }
  })

  test('unknown base silently falls back to aimux', () => {
    const id = 'test-bad-base'
    cleanup.push(id)
    try {
      registerUserThemes({
        [id]: themes.define(id, 'does-not-exist', {}),
      })
      const out = THEMES[id]
      if (!out) throw new Error('theme missing')
      expect(out.colors['editor.background']).toBe(
        requireTheme('aimux').colors['editor.background']
      )
    } finally {
      cleanupRegistered()
    }
  })
})

describe('migrateThemeId', () => {
  test('passes known ids through', () => {
    expect(migrateThemeId('dracula')).toBe('dracula')
    expect(migrateThemeId('aimux')).toBe('aimux')
  })

  test('maps legacy aliases to current ids', () => {
    expect(migrateThemeId('kanagawa')).toBe('kanagawa-wave')
    expect(migrateThemeId('one-dark')).toBe('one-dark-pro')
    expect(migrateThemeId('everforest')).toBe('everforest-dark')
    expect(migrateThemeId('gruvbox-dark')).toBe('gruvbox-dark-hard')
  })

  test('falls back to aimux for unknown input', () => {
    expect(migrateThemeId(undefined)).toBe('aimux')
    expect(migrateThemeId('nonsense-id')).toBe('aimux')
  })
})

describe('filterThemeIds', () => {
  test('null/empty filter returns the full list', () => {
    expect(filterThemeIds(null).length).toBe(THEME_IDS.length)
    expect(filterThemeIds('').length).toBe(THEME_IDS.length)
  })

  test('matches against the theme id', () => {
    const result = filterThemeIds('aimux')
    expect(result).toContain('aimux')
  })

  test('matches against the display name, case-insensitive', () => {
    const result = filterThemeIds('dracula at night')
    expect(result).toContain('dracula-at-night')
  })

  test('returns empty for no matches', () => {
    expect(filterThemeIds('zzz-does-not-exist')).toEqual([])
  })
})

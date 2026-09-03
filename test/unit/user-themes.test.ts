import { clearRuntimeThemes, isKnownThemeId, themeIds } from '@brimveyn/aimux-config'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { filterThemeIds } from '../../src/ui/filter-themes'
import { BUILTIN_THEME_IDS } from '../../src/ui/themes'
import { getUserThemesDir, loadUserThemes } from '../../src/ui/user-themes'

/**
 * The shipped theme registry is a static import list — nothing short of a
 * rebuild could add to it. `<profile>/themes/*.json` is the way in, and the
 * shape is the same one the shipped themes use so an author can copy, edit and
 * drop in.
 */

const originalHome = process.env.HOME
const originalProfile = process.env.AIMUX_PROFILE
let tempHome = ''

function writeTheme(name: string, contents: unknown): void {
  const dir = getUserThemesDir()
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, name),
    typeof contents === 'string' ? contents : JSON.stringify(contents),
    'utf8'
  )
}

const VALID = { theme: { background: { dark: '#000', light: '#fff' } } }

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'aimux-user-themes-'))
  process.env.HOME = tempHome
  process.env.AIMUX_PROFILE = 'theme-test'
})

afterEach(() => {
  clearRuntimeThemes()
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalProfile === undefined) delete process.env.AIMUX_PROFILE
  else process.env.AIMUX_PROFILE = originalProfile
  rmSync(tempHome, { force: true, recursive: true })
})

describe('user themes', () => {
  test('no themes directory is not an error', () => {
    const loaded = loadUserThemes()
    expect(loaded.ids).toEqual([])
    expect(loaded.issues).toEqual([])
  })

  test('a valid theme becomes known, listed and filterable', () => {
    writeTheme('midnight.json', VALID)
    const loaded = loadUserThemes()

    expect(loaded.issues).toEqual([])
    // The filename is the id, the way the shipped registry keys its imports.
    expect(loaded.ids).toEqual(['midnight'])
    expect(isKnownThemeId('midnight')).toBe(true)
    expect(themeIds()).toContain('midnight')
    expect(filterThemeIds('midni')).toEqual(['midnight'])
  })

  test('disposing takes it back out of the picker', () => {
    writeTheme('midnight.json', VALID)
    const loaded = loadUserThemes()
    loaded.dispose()

    expect(isKnownThemeId('midnight')).toBe(false)
    expect(themeIds()).toEqual(BUILTIN_THEME_IDS)
  })

  test('a file that is not JSON is reported, not thrown', () => {
    writeTheme('broken.json', '{ nope')
    const loaded = loadUserThemes()
    expect(loaded.ids).toEqual([])
    expect(loaded.issues[0]?.message).toContain('not valid JSON')
  })

  test('a file that is not a theme is reported', () => {
    writeTheme('notatheme.json', { colours: {} })
    const loaded = loadUserThemes()
    // Falling through to a screen of defaults would look like the theme
    // "worked" and be far harder to diagnose.
    expect(loaded.issues[0]?.message).toContain('theme')
    expect(loaded.ids).toEqual([])
  })

  test('a shipped id cannot be shadowed', () => {
    writeTheme('dracula.json', VALID)
    const loaded = loadUserThemes()
    // "Which dracula?" must not depend on load order.
    expect(loaded.ids).toEqual([])
    expect(loaded.issues[0]?.message).toContain('already a theme id')
  })

  test('one bad file does not stop the others loading', () => {
    writeTheme('broken.json', '{ nope')
    writeTheme('midnight.json', VALID)
    const loaded = loadUserThemes()
    expect(loaded.ids).toEqual(['midnight'])
    expect(loaded.issues).toHaveLength(1)
  })
})

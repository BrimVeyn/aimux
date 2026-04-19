import {
  type BundledLanguage,
  createHighlighter,
  type Highlighter,
  type ThemeRegistrationRaw,
} from 'shiki'

import { getCurrentTheme } from './theme-store'
import { paletteToShikiTheme } from './themes'

function buildActiveTheme(): { id: string; raw: ThemeRegistrationRaw } {
  const theme = getCurrentTheme()
  const id = `${theme.name}-${theme.mode}`
  return { id, raw: paletteToShikiTheme({ mode: theme.mode, name: id, palette: theme.palette }) }
}

let highlighterPromise: Promise<Highlighter> | null = null
let activeThemeId: string | null = null

export async function getShikiHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    const initial = buildActiveTheme()
    activeThemeId = initial.id
    highlighterPromise = createHighlighter({ langs: [], themes: [initial.raw] })
  }
  return highlighterPromise
}

const loadedLangs = new Set<string>()

export async function ensureShikiLang(h: Highlighter, lang: string): Promise<boolean> {
  if (loadedLangs.has(lang)) return true
  try {
    await h.loadLanguage(lang as BundledLanguage)
    loadedLangs.add(lang)
    return true
  } catch {
    return false
  }
}

/**
 * Make sure the active aimux theme (light or dark, with any palette overrides)
 * is loaded into the highlighter. Returns the registered theme name so the
 * caller can pass it to `codeToTokens`.
 */
export async function ensureActiveShikiTheme(h: Highlighter): Promise<string> {
  const { id, raw } = buildActiveTheme()
  if (id === activeThemeId) return id
  try {
    await h.loadTheme(raw)
    activeThemeId = id
  } catch {
    // Reloading the theme is best-effort; on failure we keep using the prior id.
  }
  return activeThemeId ?? id
}

import { type BundledLanguage, type BundledTheme, createHighlighter, type Highlighter } from 'shiki'

import { synthShikiTheme } from './synth-shiki-theme'
import { THEMES } from './themes'
import { GENERATED_THEME_IDS } from './themes.generated'

const DEFAULT_THEME: BundledTheme = 'catppuccin-mocha'
const BUILTIN_IDS = new Set<string>(GENERATED_THEME_IDS)

let highlighterPromise: Promise<Highlighter> | null = null

export async function getShikiHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({ langs: [], themes: [DEFAULT_THEME] })
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

const loadedThemes = new Set<string>([DEFAULT_THEME])

export async function ensureShikiTheme(h: Highlighter, themeId: string): Promise<boolean> {
  if (loadedThemes.has(themeId)) return true
  try {
    if (BUILTIN_IDS.has(themeId)) {
      await h.loadTheme(themeId as BundledTheme)
    } else {
      const entry = THEMES[themeId]
      if (!entry) return false
      // eslint-disable-next-line typescript/no-explicit-any
      await h.loadTheme(synthShikiTheme(themeId, entry.colors, entry.type) as any)
    }
    loadedThemes.add(themeId)
    return true
  } catch {
    return false
  }
}

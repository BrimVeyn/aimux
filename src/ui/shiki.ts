import { type BundledLanguage, type BundledTheme, createHighlighter, type Highlighter } from 'shiki'

const DEFAULT_THEME: BundledTheme = 'catppuccin-mocha'

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
    await h.loadTheme(themeId as BundledTheme)
    loadedThemes.add(themeId)
    return true
  } catch {
    return false
  }
}

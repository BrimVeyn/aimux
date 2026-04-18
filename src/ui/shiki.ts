import { type BundledLanguage, type BundledTheme, createHighlighter, type Highlighter } from 'shiki'

import { THEMES } from './themes'

// Shiki's highlighter is created with at least one real shiki-bundled theme so
// its worker can warm up. House and user themes load on demand.
const WARM_THEME: BundledTheme = 'catppuccin-mocha'

let highlighterPromise: Promise<Highlighter> | null = null

export async function getShikiHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({ langs: [], themes: [WARM_THEME] })
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

const loadedThemes = new Set<string>([WARM_THEME])

/**
 * Load the theme keyed by `id` into the shiki highlighter. The same object
 * powers the UI palette and the code highlighter — no synthesis, no mapping.
 */
export async function ensureShikiTheme(h: Highlighter, id: string): Promise<boolean> {
  if (loadedThemes.has(id)) return true
  const entry = THEMES[id]
  if (!entry) return false
  try {
    // eslint-disable-next-line typescript/no-explicit-any
    await h.loadTheme(entry as any)
    loadedThemes.add(id)
    return true
  } catch {
    return false
  }
}

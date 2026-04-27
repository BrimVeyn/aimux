import { tuiThemeToShiki } from '@brimveyn/aimux-config'
import {
  type BundledLanguage,
  createHighlighter,
  type Highlighter,
  type ThemeRegistrationRaw,
} from 'shiki'

import { getCurrentMode, getCurrentTheme, getCurrentThemeId } from './theme-store'

function buildActiveTheme(): { id: string; raw: ThemeRegistrationRaw } {
  const id = `${getCurrentThemeId()}-${getCurrentMode()}`
  return {
    id,
    raw: tuiThemeToShiki({ mode: getCurrentMode(), name: id, theme: getCurrentTheme() }),
  }
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

export async function ensureActiveShikiTheme(h: Highlighter): Promise<string> {
  const { id, raw } = buildActiveTheme()
  if (id === activeThemeId) return id
  try {
    await h.loadTheme(raw)
    activeThemeId = id
  } catch {
    // best-effort
  }
  return activeThemeId ?? id
}

import { type BundledLanguage, createHighlighter, type Highlighter } from 'shiki'

const THEMES = [
  'catppuccin-mocha',
  'dracula',
  'nord',
  'one-dark-pro',
  'solarized-dark',
  'tokyo-night',
] as const

let highlighterPromise: Promise<Highlighter> | null = null

export async function getShikiHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({ langs: [], themes: [...THEMES] })
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

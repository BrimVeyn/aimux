import type { ThemedToken } from 'shiki'

import { ensureShikiLang, ensureShikiTheme, getShikiHighlighter } from '../../shiki'

export interface HighlightSpan {
  bold?: boolean
  fg?: string
  italic?: boolean
  text: string
  underline?: boolean
}

// Shiki FontStyle: 1 = italic, 2 = bold, 4 = underline.
export function tokenToSpan(token: ThemedToken): HighlightSpan {
  const fs = token.fontStyle ?? 0
  return {
    bold: (fs & 2) !== 0 || undefined,
    fg: token.color,
    italic: (fs & 1) !== 0 || undefined,
    text: token.content,
    underline: (fs & 4) !== 0 || undefined,
  }
}

export async function tokenizeSide(
  lines: string[],
  lang: string,
  theme: string
): Promise<ThemedToken[][]> {
  if (lines.length === 0) return []
  const highlighter = await getShikiHighlighter()
  const [langOk, themeOk] = await Promise.all([
    ensureShikiLang(highlighter, lang),
    ensureShikiTheme(highlighter, theme),
  ])
  if (!langOk || !themeOk) return []
  try {
    const result = highlighter.codeToTokens(lines.join(''), {
      // eslint-disable-next-line typescript/no-explicit-any
      lang: lang as any,
      // eslint-disable-next-line typescript/no-explicit-any
      theme: theme as any,
    })
    return result.tokens
  } catch {
    return []
  }
}

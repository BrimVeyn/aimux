import type { ThemedToken } from 'shiki'

import { TextAttributes } from '@opentui/core'
import { memo, useEffect, useState } from 'react'

import type { PieceOp } from '../../../../markdown-diff'

import { useTheme } from '../../../theme'
import { tokenizeSide, tokenToSpan } from '../diff-renderer/highlight'

export interface CodeLine {
  op: PieceOp
  text: string
}

const MAX_CACHED = 200
const cache = new Map<string, ThemedToken[][]>()

// Highlighted with the same shiki theme as the text diff, so a fenced block reads
// the way the file it was copied from does.
function useCodeTokens(lines: readonly string[], lang: string, themeId: string): ThemedToken[][] {
  const key = `${themeId}\u0000${lang}\u0000${lines.join('\n')}`
  const [tokens, setTokens] = useState<ThemedToken[][]>(() => cache.get(key) ?? [])
  useEffect(() => {
    const hit = cache.get(key)
    if (hit) {
      setTokens(hit)
      return
    }
    setTokens([])
    if (lang === '') return
    let cancelled = false
    void (async () => {
      const result = await tokenizeSide(
        lines.map((l) => `${l}\n`),
        lang
      )
      cache.set(key, result)
      if (cache.size > MAX_CACHED) {
        const oldest = cache.keys().next().value
        if (oldest !== undefined) cache.delete(oldest)
      }
      if (!cancelled) setTokens(result)
    })()
    return () => {
      cancelled = true
    }
    // `key` stands for lines + lang + theme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return tokens
}

interface CodeBlockProps {
  lang: string
  lines: readonly CodeLine[]
  themeId: string
}

export const CodeBlock = memo(function CodeBlock({ lang, lines, themeId }: CodeBlockProps) {
  const t = useTheme()
  // Tokenised as one text so multi-line constructs (strings, comments) carry over;
  // the diff ops only decide the background of each line.
  const tokens = useCodeTokens(
    lines.map((l) => l.text),
    lang,
    themeId
  )
  return (
    <box
      flexDirection="column"
      backgroundColor={t.backgroundPanel}
      paddingLeft={1}
      paddingRight={1}
    >
      {lang !== '' ? <text fg={t.textMuted}>{lang}</text> : null}
      {lines.map((line, i) => {
        let bg: string | undefined
        if (line.op === 'add') bg = t.diffAddedBg
        if (line.op === 'del') bg = t.diffRemovedBg
        const lineTokens = tokens[i]
        return (
          // Lines are positional within one block.
          // eslint-disable-next-line react/no-array-index-key
          <box key={i} backgroundColor={bg}>
            {lineTokens && lineTokens.length > 0 ? (
              <text wrapMode="none">
                {lineTokens.map((tok, j) => {
                  const s = tokenToSpan(tok)
                  let attributes = 0
                  if (s.bold === true) attributes |= TextAttributes.BOLD
                  if (s.italic === true) attributes |= TextAttributes.ITALIC
                  return (
                    // eslint-disable-next-line react/no-array-index-key
                    <span key={j} attributes={attributes} fg={s.fg ?? t.markdownCodeBlock}>
                      {s.text}
                    </span>
                  )
                })}
              </text>
            ) : (
              <text fg={t.markdownCodeBlock} wrapMode="none">
                {line.text === '' ? ' ' : line.text}
              </text>
            )}
          </box>
        )
      })}
    </box>
  )
})

import type { ThemedToken } from 'shiki'

import { TextAttributes } from '@opentui/core'

import { useTheme } from '../../../theme'
import { expandTabs } from './build-rows'
import { tokenToSpan } from './highlight'

/**
 * One line of code. Every row is drawn at the height `wrapCount` worked out for
 * it, so this must wrap exactly the way that arithmetic assumes: by character,
 * with tabs expanded the same way. A word wrap would take more rows than it was
 * given and lose its tail; fewer columns than assumed leave blank rows behind.
 */
export function LineContent({
  content,
  tokens,
  width,
}: {
  content: string
  tokens: ThemedToken[] | undefined
  /**
   * The measured text columns, set outright: flex alone sizes a text by its own
   * length and lets it run a column past the row, where it is clipped and wraps
   * one column later than its height was worked out for. Zero before the first
   * measurement, when it is left to flex.
   */
  width: number
}) {
  const t = useTheme()
  const size = width > 0 ? { flexShrink: 0, width } : { flexGrow: 1, flexShrink: 1 }
  if (!tokens || tokens.length === 0) {
    return (
      <text {...size} fg={t.text} wrapMode="char">
        {expandTabs(content)}
      </text>
    )
  }
  return (
    <text {...size} wrapMode="char">
      {tokens.map((tok, i) => {
        const s = tokenToSpan(tok)
        let attributes = 0
        if (s.bold === true) attributes |= TextAttributes.BOLD
        if (s.italic === true) attributes |= TextAttributes.ITALIC
        if (s.underline === true) attributes |= TextAttributes.UNDERLINE
        return (
          // Syntax tokens are positional within a single line and never reorder.
          // eslint-disable-next-line react/no-array-index-key
          <span key={i} fg={s.fg ?? t.text} attributes={attributes}>
            {expandTabs(s.text)}
          </span>
        )
      })}
    </text>
  )
}

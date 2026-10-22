import type { TerminalLine } from '../state/types'

export function getLineText(line: TerminalLine): string {
  return line.spans.map((span) => span.text).join('')
}

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/g

/**
 * Link under `column`: the cell's OSC 8 target when the app emitted one (its
 * text may be a bare label like `google.com`), else a plain URL in the text.
 */
export function getLinkAtColumn(line: TerminalLine, column: number): string | null {
  let start = 0
  for (const span of line.spans) {
    const end = start + span.text.length
    if (column >= start && column < end) {
      if (span.link !== undefined) return span.link
      break
    }
    start = end
  }
  return getUrlAtColumn(getLineText(line), column)
}

/** URL under `column`, or null. Trailing prose punctuation is not part of it. */
function getUrlAtColumn(lineText: string, column: number): string | null {
  for (const match of lineText.matchAll(URL_PATTERN)) {
    const url = match[0].replace(/[.,;:!?)\]}]+$/, '')
    if (column >= match.index && column < match.index + url.length) return url
  }
  return null
}

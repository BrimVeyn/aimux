import type { TerminalLine } from '../state/types'

export function getLineText(line: TerminalLine): string {
  return line.spans.map((span) => span.text).join('')
}

/**
 * Extract text from a range of terminal lines as a single string.
 *
 * Trailing `[ \t]+` is stripped from each joined segment to drop the viewport
 * padding the snapshot layer fills blank cells with (every rendered row is now
 * padded to the full terminal width to prevent ghosting). Without this, shell
 * line continuations (`\` + padding spaces + `\n`) paste as escaped-space
 * sequences, and a single-line copy dragged to/past end-of-line would pick up
 * the synthetic padding spaces.
 */
export function extractStreamText(
  lines: TerminalLine[],
  startRowArg: number,
  startColArg: number,
  endRowArg: number,
  endColArg: number
): string {
  let startRow = startRowArg
  let startCol = startColArg
  let endRow = endRowArg
  let endCol = endColArg
  if (startRow > endRow || (startRow === endRow && startCol > endCol)) {
    ;[startRow, endRow] = [endRow, startRow]
    ;[startCol, endCol] = [endCol, startCol]
  }

  const clampedStart = Math.max(0, startRow)
  const clampedEnd = Math.min(lines.length - 1, endRow)
  const parts: string[] = []

  for (let row = clampedStart; row <= clampedEnd; row++) {
    const text = getLineText(lines[row] as TerminalLine)
    if (row === startRow && row === endRow) {
      parts.push(rtrim(text.slice(Math.max(0, startCol), Math.max(0, endCol))))
    } else if (row === startRow) {
      parts.push(rtrim(text.slice(Math.max(0, startCol))))
    } else if (row === endRow) {
      parts.push(rtrim(text.slice(0, Math.max(0, endCol))))
    } else {
      parts.push(rtrim(text))
    }
  }

  return parts.join('\n')
}

function rtrim(text: string): string {
  return text.replace(/[ \t]+$/, '')
}

export function getWordAtColumn(
  lineText: string,
  column: number
): { text: string; startCol: number; endCol: number } {
  if (column < 0 || column >= lineText.length) {
    return { endCol: column, startCol: column, text: '' }
  }

  const ch = lineText[column]
  if (ch == null || ch === '' || !/\S/.test(ch)) {
    return { endCol: column, startCol: column, text: '' }
  }

  let startCol = column
  while (startCol > 0 && /\S/.test(lineText[startCol - 1] as string)) {
    startCol--
  }

  let endCol = column
  while (endCol < lineText.length && /\S/.test(lineText[endCol] as string)) {
    endCol++
  }

  return { endCol, startCol, text: lineText.slice(startCol, endCol) }
}

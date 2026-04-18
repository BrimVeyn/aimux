// Vendored from @pierre/diffs v1.1.15 — parser only. See AIMUX-14.
/* eslint-disable no-console, no-nested-ternary */

import type { HunkLineType } from './types'

export interface ParsedLine {
  line: string
  type: HunkLineType
}

export function parseLineType(line: string): ParsedLine | undefined {
  const firstChar = line[0]
  if (firstChar !== '+' && firstChar !== '-' && firstChar !== ' ' && firstChar !== '\\') {
    console.error(`parseLineType: Invalid firstChar: "${firstChar}", full line: "${line}"`)
    return
  }
  const processedLine = line.substring(1)
  return {
    line: processedLine === '' ? '\n' : processedLine,
    type:
      firstChar === ' '
        ? 'context'
        : firstChar === '\\'
          ? 'metadata'
          : firstChar === '+'
            ? 'addition'
            : 'deletion',
  }
}

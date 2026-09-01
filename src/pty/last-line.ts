/**
 * Extract a terminal viewport's last non-blank rendered line.
 *
 * Used by the daemon's `listTabs` handler to answer "what is this worker
 * doing?" without a per-tab `snapshot` round-trip. Unlike the status loop's
 * private `tailPreview`, this does NOT cap the width — the orchestrator wants
 * the whole status line — and it returns `undefined` (rather than a sentinel)
 * when there is nothing to show, so the field is simply omitted from the wire.
 */
import type { TerminalSnapshot } from '../state/types'

import { getLineText } from '../input/terminal-text-extraction'

/**
 * The last non-blank line of `viewport`, trimmed. Scans rows from the bottom so
 * trailing blank rows are skipped. Returns `undefined` when the viewport is
 * missing or entirely blank.
 */
export function lastNonBlankLine(viewport: TerminalSnapshot | undefined): string | undefined {
  if (!viewport) return undefined
  const lines = viewport.lines
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line) continue
    const text = getLineText(line).trim()
    if (text.length > 0) return text
  }
  return undefined
}

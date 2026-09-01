import type { TerminalSnapshot } from '../state/types'

export interface SnapshotLineOptions {
  /** When true (default), strip trailing whitespace from each line so the
   *  serialised output isn't a sea of padding cells the LLM has to chew
   *  through. Pass false when you need the exact alignment of the terminal
   *  (e.g. ASCII art / fixed-column TUIs). */
  trim?: boolean
}

/**
 * Flatten a TerminalSnapshot into plain text — concatenate every span's
 * `text` per line. No ANSI, no palette resolution. Agents consume strings,
 * not pixels.
 */
export function snapshotToLines(
  snapshot: TerminalSnapshot,
  options: SnapshotLineOptions = {}
): string[] {
  const trim = options.trim !== false
  return snapshot.lines.map((line) => {
    const joined = line.spans.map((span) => span.text).join('')
    return trim ? joined.replace(/\s+$/u, '') : joined
  })
}

/**
 * Like `snapshotToLines` but trims trailing blank lines and slices to the
 * last `n` non-blank lines. Mirrors the `--tail N` flag.
 */
export function snapshotTailLines(
  snapshot: TerminalSnapshot,
  n: number,
  options: SnapshotLineOptions = {}
): string[] {
  const all = snapshotToLines(snapshot, options)
  let end = all.length
  while (end > 0 && (all[end - 1] ?? '').trim() === '') end--
  const trimmed = all.slice(0, end)
  if (n <= 0 || trimmed.length <= n) return trimmed
  return trimmed.slice(trimmed.length - n)
}

/**
 * Plain-text dump: lines joined by `\n`, single trailing newline. Best shape
 * for piping into an LLM since it preserves the screen's visual layout
 * without JSON-escape noise.
 */
export function snapshotToText(
  snapshot: TerminalSnapshot,
  options: SnapshotLineOptions = {}
): string {
  return `${snapshotToLines(snapshot, options).join('\n')}\n`
}

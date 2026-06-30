import type { TerminalSnapshot } from '../state/types'

/**
 * Flatten a TerminalSnapshot into plain text — concatenate every span's
 * `text` per line. No ANSI, no palette resolution. Agents consume strings,
 * not pixels.
 */
export function snapshotToLines(snapshot: TerminalSnapshot): string[] {
  return snapshot.lines.map((line) => line.spans.map((span) => span.text).join(''))
}

/**
 * Like `snapshotToLines` but trims trailing blank lines and slices to the
 * last `n` non-blank lines. Mirrors the `--tail N` flag.
 */
export function snapshotTailLines(snapshot: TerminalSnapshot, n: number): string[] {
  const all = snapshotToLines(snapshot)
  let end = all.length
  while (end > 0 && (all[end - 1] ?? '').trim() === '') end--
  const trimmed = all.slice(0, end)
  if (n <= 0 || trimmed.length <= n) return trimmed
  return trimmed.slice(trimmed.length - n)
}

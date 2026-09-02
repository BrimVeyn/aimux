/**
 * Cursor motion inside a modal's text buffer.
 *
 * Pure string maths, kept out of the reducer so it can be read and tested on its
 * own — the reducer only decides *which* buffer a motion applies to.
 *
 * ponytail: lines are `\n`-delimited, not visually wrapped. A paragraph that the
 * input box soft-wraps over three rows is one line here, so Up/Down step over
 * the whole paragraph. Fixing that means the motion needs the box's width, which
 * lives in the renderer, not the store — worth doing only if the wrapped fields
 * ever get long enough for it to bite.
 */

/** Where a motion wants to go. `home`/`end` are line-wise, so they do the right thing in a one-line field too. */
export type CursorTarget = 'end' | 'home' | 'line-down' | 'line-up' | 'word-left' | 'word-right'

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(max, value))
}

/**
 * The `[start, end)` of the line `at` sits on. `end` is the newline's index (or
 * the buffer's length on the last line), so it is where `End` parks.
 */
function lineBounds(text: string, at: number): { end: number; start: number } {
  // `lastIndexOf` clamps a negative `fromIndex` to 0, which would find a leading
  // newline and put the start one past it — so column 0 is answered directly.
  const start = at === 0 ? 0 : text.lastIndexOf('\n', at - 1) + 1
  const newline = text.indexOf('\n', at)
  return { end: newline === -1 ? text.length : newline, start }
}

const isWordChar = (ch: string | undefined): boolean => ch !== undefined && /\S/.test(ch)

/** Left edge of the word before the cursor: skip the gap, then the word. */
function wordLeft(text: string, at: number): number {
  let i = at
  while (i > 0 && !isWordChar(text[i - 1])) i--
  while (i > 0 && isWordChar(text[i - 1])) i--
  return i
}

/** Right edge of the word after the cursor, by the same rule. */
function wordRight(text: string, at: number): number {
  let i = at
  while (i < text.length && !isWordChar(text[i])) i++
  while (i < text.length && isWordChar(text[i])) i++
  return i
}

/** The same column on the line above, or as near to it as that line reaches. */
function lineUp(text: string, at: number): number {
  const { start } = lineBounds(text, at)
  // Already on the first line: Up parks at its start rather than doing nothing,
  // which is what every editor does with it.
  if (start === 0) return 0
  const previous = lineBounds(text, start - 1)
  return Math.min(previous.start + (at - start), previous.end)
}

/** The same column on the line below. */
function lineDown(text: string, at: number): number {
  const { end, start } = lineBounds(text, at)
  if (end === text.length) return text.length
  const next = lineBounds(text, end + 1)
  return Math.min(next.start + (at - start), next.end)
}

/** Resolve one motion against `text`, clamped to it. */
export function moveCursor(
  text: string,
  at: number,
  motion: { delta?: number; to?: CursorTarget }
): number {
  const from = clamp(at, text.length)
  if (motion.to === undefined) {
    return clamp(from + (motion.delta ?? 0), text.length)
  }
  switch (motion.to) {
    case 'home':
      return lineBounds(text, from).start
    case 'end':
      return lineBounds(text, from).end
    case 'word-left':
      return wordLeft(text, from)
    case 'word-right':
      return wordRight(text, from)
    case 'line-up':
      return lineUp(text, from)
    case 'line-down':
      return lineDown(text, from)
    default:
      motion.to satisfies never
      return from
  }
}

/**
 * Apply one edit at the cursor. `\b` deletes behind it, `\x7f` in front of it —
 * neither can arrive as typed text, which is why they double as the two commands.
 */
export function applyEdit(
  text: string,
  at: number,
  char: string
): { pos: number; text: string } | null {
  const from = clamp(at, text.length)
  if (char === '\b') {
    if (from === 0) return null
    return { pos: from - 1, text: text.slice(0, from - 1) + text.slice(from) }
  }
  if (char === '\x7f') {
    if (from === text.length) return null
    return { pos: from, text: text.slice(0, from) + text.slice(from + 1) }
  }
  return { pos: from + char.length, text: text.slice(0, from) + char + text.slice(from) }
}

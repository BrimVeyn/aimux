import { parseKeyNotation } from '../input/keymap/key-chord'

/**
 * Map a vim-style key notation string ("<C-c>", "<Esc>", "ga", "<C-x><C-s>")
 * into the raw bytes the receiving terminal expects. Reuses
 * `parseKeyNotation` to turn the notation into canonical chord strings, then
 * lowers each chord into a byte sequence.
 *
 * Recognised special keys:
 *   <CR>/<Tab>/<Esc>/<Space>/<BS>/<Up>/<Down>/<Left>/<Right>
 * Recognised modifier: `<C-letter>` (Ctrl) — case insensitive `C-`.
 */
export function notationToBytes(notation: string): Buffer {
  const chords = parseKeyNotation(notation)
  const parts: Buffer[] = []
  for (const chord of chords) {
    parts.push(chordToBytes(chord))
  }
  return Buffer.concat(parts)
}

const ESC_BRACKET = Buffer.from([0x1b, 0x5b])

function chordToBytes(chord: string): Buffer {
  if (chord.length === 1) {
    return Buffer.from(chord, 'utf8')
  }

  // Modifier+letter (Ctrl only — Alt/Meta lowering is more terminal-specific).
  if (chord.startsWith('C-') && chord.length >= 3) {
    const tail = chord.slice(2)
    if (tail.length === 1) {
      const ch = tail.toLowerCase()
      const code = ch.charCodeAt(0)
      if (code >= 0x61 && code <= 0x7a) {
        return Buffer.from([code - 0x60])
      }
    }
    if (tail === 'space') return Buffer.from([0x00])
    if (tail === '?') return Buffer.from([0x7f])
  }

  switch (chord) {
    case 'return':
      return Buffer.from([0x0d])
    case 'tab':
      return Buffer.from([0x09])
    case 'escape':
      return Buffer.from([0x1b])
    case 'space':
      return Buffer.from([0x20])
    case 'backspace':
      return Buffer.from([0x7f])
    case 'up':
      return Buffer.concat([ESC_BRACKET, Buffer.from([0x41])])
    case 'down':
      return Buffer.concat([ESC_BRACKET, Buffer.from([0x42])])
    case 'right':
      return Buffer.concat([ESC_BRACKET, Buffer.from([0x43])])
    case 'left':
      return Buffer.concat([ESC_BRACKET, Buffer.from([0x44])])
    default:
      throw new Error(`unsupported chord: ${chord}`)
  }
}

const BRACKETED_PASTE_START = '\x1b[200~'
const BRACKETED_PASTE_END = '\x1b[201~'

/**
 * Wrap a multi-line block in bracketed-paste markers so the receiver does not
 * treat each `\n` as a submit keystroke. Single-line text is passed through.
 */
export function bracketedPaste(text: string): string {
  if (!text.includes('\n')) return text
  return `${BRACKETED_PASTE_START}${text}${BRACKETED_PASTE_END}`
}

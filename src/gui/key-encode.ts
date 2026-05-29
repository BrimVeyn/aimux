import type { KeyInput } from '../input/modes/types'

// Encode a KeyInput into the terminal byte string a PTY expects. Used for the
// terminal-input passthrough path: when the keymap handler does not bind a key
// in terminal-input mode, the raw keystroke is forwarded to the active PTY.
// The browser already normalizes its KeyboardEvent into the KeyInput shape
// ({ name, ctrl, meta, shift, sequence }) that aimux's keymap layer consumes.

const NAMED: Record<string, string> = {
  backspace: '\x7f',
  delete: '\x1b[3~',
  down: '\x1b[B',
  end: '\x1b[F',
  escape: '\x1b',
  home: '\x1b[H',
  insert: '\x1b[2~',
  left: '\x1b[D',
  pagedown: '\x1b[6~',
  pageup: '\x1b[5~',
  return: '\r',
  right: '\x1b[C',
  space: ' ',
  tab: '\t',
  up: '\x1b[A',
}

export function encodeKeyInput(key: KeyInput): string | null {
  const named = NAMED[key.name]
  if (named !== undefined) {
    return key.meta ? `\x1b${named}` : named
  }

  // Ctrl+letter -> control byte (Ctrl+C = 0x03, ...).
  if (key.ctrl && key.name.length === 1) {
    const code = key.name.toUpperCase().charCodeAt(0)
    if (code >= 64 && code <= 95) {
      return String.fromCharCode(code & 0x1f)
    }
    return null
  }

  // Printable: prefer the raw sequence (already reflects shift/symbols).
  let char = ''
  if (key.sequence.length === 1) {
    char = key.sequence
  } else if (key.name.length === 1) {
    char = key.name
  }
  if (char === '') {
    return null
  }
  return key.meta ? `\x1b${char}` : char
}

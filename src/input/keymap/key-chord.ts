import type { KeyInput } from '../modes/types'

/**
 * Canonical string representation of a single key press.
 * Examples: "C-n", "d", "J", "escape", "space", "?", "C-M-x"
 * Modifier prefix order: C- (ctrl), M- (meta/alt), then the key name.
 * Shift+letter is encoded as uppercase: Shift+j → "J".
 */
export type KeyChord = string

const SPECIAL_NAMES: Record<string, string> = {
  BS: 'backspace',
  CR: 'return',
  Down: 'down',
  Esc: 'escape',
  Left: 'left',
  Right: 'right',
  Space: 'space',
  Tab: 'tab',
  Up: 'up',
}

/**
 * Convert a runtime KeyInput (from @opentui/core KeyEvent) to a canonical KeyChord.
 */
export function keyInputToChord(key: KeyInput): KeyChord {
  const { ctrl, meta, name, sequence, shift } = key

  // For single-character sequences that differ from name (e.g., '?' comes as sequence='?' name='?')
  // Use sequence for punctuation/symbols not captured by name
  const baseName = name === 'undefined' || name === '' ? sequence : name

  // Shift+letter → uppercase letter (no S- prefix)
  if (shift && !ctrl && !meta && baseName.length === 1 && /^[a-z]$/.test(baseName)) {
    return baseName.toUpperCase()
  }

  let prefix = ''
  if (ctrl) prefix += 'C-'
  if (meta) prefix += 'M-'

  return `${prefix}${baseName}`
}

// Regex to match <...> notation tokens
const ANGLE_BRACKET_RE = /<([^>]+)>/g

/**
 * Parse a vim-style key notation string into an array of KeyChords.
 *
 * Supports:
 * - `<C-n>`, `<M-x>`, `<C-M-a>` — modifier combos
 * - `<CR>`, `<Esc>`, `<Space>`, `<BS>`, `<Tab>` — special keys
 * - `<Down>`, `<Up>`, `<Left>`, `<Right>` — arrow keys
 * - `<leader>` — substituted with the provided leader KeyChord
 * - `dd`, `gj` — bare characters produce one KeyChord each
 *
 * Examples:
 * - `"<C-n>"` → `["C-n"]`
 * - `"dd"` → `["d", "d"]`
 * - `"<leader>tn"` → `["space", "t", "n"]` (if leader is "space")
 */
export function parseKeyNotation(notation: string, leader?: KeyChord): KeyChord[] {
  const chords: KeyChord[] = []
  let lastIndex = 0

  for (const match of notation.matchAll(ANGLE_BRACKET_RE)) {
    const matchIndex = match.index ?? 0
    const matchText = match[0] ?? ''
    const inner = match[1] ?? ''

    // Process bare characters before this angle-bracket token
    for (let i = lastIndex; i < matchIndex; i++) {
      const ch = notation[i]
      if (ch !== undefined) chords.push(ch)
    }

    // Handle <leader>
    if (inner.toLowerCase() === 'leader') {
      if (!(leader != null && leader !== '')) {
        throw new Error('parseKeyNotation: <leader> used but no leader key configured')
      }
      chords.push(leader)
      lastIndex = matchIndex + matchText.length
      continue
    }

    // Parse modifier+key combo: C-n, M-x, C-M-a, S-g
    chords.push(parseAngleBracketToken(inner))
    lastIndex = matchIndex + matchText.length
  }

  // Process remaining bare characters after last angle-bracket match
  for (let i = lastIndex; i < notation.length; i++) {
    const ch = notation[i]
    if (ch !== undefined) chords.push(ch)
  }

  return chords
}

function parseAngleBracketToken(inner: string): KeyChord {
  // Check if it's a special name (no modifiers)
  const specialInner = SPECIAL_NAMES[inner]
  if (specialInner != null && specialInner !== '') {
    return specialInner
  }

  // Parse modifiers: split by '-', last part is the key
  const parts = inner.split('-')
  let ctrl = false
  let meta = false
  let shift = false

  // All parts except the last are modifiers
  for (let i = 0; i < parts.length - 1; i++) {
    const mod = (parts[i] ?? '').toUpperCase()
    if (mod === 'C') ctrl = true
    else if (mod === 'M' || mod === 'A') meta = true
    else if (mod === 'S') shift = true
  }

  let keyName = parts.at(-1) ?? ''

  // Check if the key part is a special name
  const specialKey = SPECIAL_NAMES[keyName]
  if (specialKey != null && specialKey !== '') {
    keyName = specialKey
  }

  // Shift+letter → uppercase
  if (shift && !ctrl && !meta && keyName.length === 1 && /^[a-z]$/.test(keyName)) {
    return keyName.toUpperCase()
  }

  let prefix = ''
  if (ctrl) prefix += 'C-'
  if (meta) prefix += 'M-'

  return `${prefix}${keyName}`
}

/**
 * Convert a raw terminal byte sequence into a canonical KeyChord.
 *
 * Handles:
 * - Single control bytes (0x01..0x1a) → `"C-<letter>"` (e.g., 0x1a → `"C-z"`)
 * - Kitty CSI sequences `<ESC>[<code>;<mod>u` → `"C-<letter>"` (if ctrl modifier)
 *
 * Returns null if the sequence doesn't map to a recognizable chord.
 */
const KITTY_CTRL_CSI_RE = new RegExp(`^${String.fromCharCode(0x1b)}\\[(\\d+);(\\d+)u$`)
const KITTY_MOD_CTRL = 4
const KITTY_MOD_SHIFT = 1
const KITTY_MOD_ALT = 2

export function rawSequenceToChord(sequence: string): KeyChord | null {
  if (sequence.length === 1) {
    const code = sequence.charCodeAt(0)

    // Control bytes: Ctrl+A (0x01) through Ctrl+Z (0x1a)
    if (code >= 0x01 && code <= 0x1a) {
      return `C-${String.fromCharCode(code + 0x60)}`
    }

    // DEL (0x7f) is backspace
    if (code === 0x7f) return 'backspace'

    // Printable ASCII (space through ~): return the char as-is.
    // Uppercase letters stay uppercase (shift convention).
    if (code >= 0x20 && code <= 0x7e) {
      return sequence
    }

    return null
  }

  // Kitty CSI: <ESC>[<code>;<mod>u
  const match = KITTY_CTRL_CSI_RE.exec(sequence)
  if (!match) return null

  const codePoint = Number(match[1])
  const modifiers = Number(match[2]) - 1
  const hasCtrl = (modifiers & KITTY_MOD_CTRL) !== 0
  const hasShift = (modifiers & KITTY_MOD_SHIFT) !== 0
  const hasAlt = (modifiers & KITTY_MOD_ALT) !== 0

  if (!hasCtrl || hasAlt) return null

  // Only handle ASCII letters for now
  if (codePoint >= 97 && codePoint <= 122) {
    const letter = String.fromCharCode(codePoint)
    const chord = hasShift ? `C-${letter.toUpperCase()}` : `C-${letter}`
    return chord
  }
  if (codePoint >= 65 && codePoint <= 90) {
    return `C-${String.fromCharCode(codePoint)}`
  }

  return null
}

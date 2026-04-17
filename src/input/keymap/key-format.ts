import { type KeyChord, parseKeyNotation } from './key-chord'

const SPECIAL_DISPLAY: Record<string, string> = {
  backspace: 'Backspace',
  down: '↓',
  escape: 'Esc',
  left: '←',
  return: 'Enter',
  right: '→',
  space: 'Space',
  tab: 'Tab',
  up: '↑',
}

function formatModifierKey(baseName: string): string {
  const special = SPECIAL_DISPLAY[baseName]
  if (special) return special
  if (baseName.length === 1) return baseName.toUpperCase()
  return baseName.charAt(0).toUpperCase() + baseName.slice(1)
}

/** Convert a single canonical KeyChord back to a human-readable label. */
export function formatChord(chord: KeyChord, leader?: KeyChord): string {
  if (leader && chord === leader) return '<leader>'

  let ctrl = false
  let meta = false
  let rest = chord

  while (true) {
    if (rest.startsWith('C-')) {
      ctrl = true
      rest = rest.slice(2)
      continue
    }
    if (rest.startsWith('M-')) {
      meta = true
      rest = rest.slice(2)
      continue
    }
    break
  }

  if (!ctrl && !meta) {
    if (rest.length === 1 && /^[A-Z]$/.test(rest)) {
      return `Shift+${rest}`
    }
    return SPECIAL_DISPLAY[rest] ?? rest
  }

  const parts: string[] = []
  if (ctrl) parts.push('Ctrl')
  if (meta) parts.push('Alt')
  parts.push(formatModifierKey(rest))
  return parts.join('+')
}

/** Convert a raw key notation string (e.g. `<C-n>`, `dd`) to a human label. */
export function formatNotationForDisplay(notation: string, leader?: KeyChord): string {
  let chords: KeyChord[]
  try {
    chords = parseKeyNotation(notation, leader)
  } catch {
    return notation
  }
  return chords.map((c) => formatChord(c, leader)).join(' ')
}

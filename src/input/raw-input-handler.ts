import type { PtyWriteOptions } from '../app-runtime/pty-write'
import type { TriggerMatch } from '../snippets/trigger-detector'
import type { FocusMode } from '../state/types'

import { logInputDebug } from '../debug/input-log'
import { type KeyChord, rawSequenceToChord } from './keymap/key-chord'
import { BRACKETED_PASTE_END, BRACKETED_PASTE_START, buildPtyPastePayload } from './paste'

const ESC = '\x1b'
const KITTY_CTRL_RE = new RegExp(`^${ESC}\\[(\\d+);(\\d+)u$`)
const KITTY_MOD_SUPER = 8
const KITTY_MOD_HYPER = 16
const KITTY_MOD_META = 32
const KITTY_HOST_MOD_MASK = KITTY_MOD_SUPER | KITTY_MOD_HYPER | KITTY_MOD_META
const FOCUS_IN_SEQUENCE = `${ESC}[I`
const FOCUS_OUT_SEQUENCE = `${ESC}[O`

function normalizeControlSequence(sequence: string): string | null {
  const match = KITTY_CTRL_RE.exec(sequence)
  if (!match) {
    return sequence
  }

  const codePoint = Number(match[1])
  const modifiers = Number(match[2]) - 1

  if ((modifiers & KITTY_HOST_MOD_MASK) !== 0) {
    return null
  }

  const hasCtrl = (modifiers & 4) !== 0
  const hasAlt = (modifiers & 2) !== 0

  if (!hasCtrl || hasAlt) {
    return sequence
  }

  if ((codePoint >= 65 && codePoint <= 90) || (codePoint >= 97 && codePoint <= 122)) {
    return String.fromCharCode(codePoint & 0x1f)
  }

  switch (codePoint) {
    case 32:
    case 50:
    case 64:
      return '\x00'
    case 51:
    case 91:
      return '\x1b'
    case 52:
    case 92:
      return '\x1c'
    case 53:
    case 93:
      return '\x1d'
    case 54:
    case 94:
      return '\x1e'
    case 47:
    case 55:
    case 95:
      return '\x1f'
    case 56:
    case 63:
      return '\x7f'
    default:
      return sequence
  }
}

export interface TerminalContentOrigin {
  /** 0-based screen column of the first content cell */
  x: number
  /** 0-based screen row of the first content cell */
  y: number
  /** PTY column count */
  cols: number
  /** PTY row count */
  rows: number
}

export function createRawInputHandler(deps: {
  getFocusMode: () => FocusMode
  getActiveTabId: () => string | null
  getBracketedPasteModeEnabled: () => boolean
  writeToPty: (tabId: string, data: string, options?: PtyWriteOptions) => void
  /**
   * Dispatch a configured terminal-input shortcut.
   * Returns true if the chord was consumed by the keymap, false otherwise.
   */
  handleTerminalShortcut: (chord: KeyChord) => boolean
  /** True when the active tab is in alternate-screen mode (vim, less, htop, ...). */
  getIsAlternateBuffer?: () => boolean
  /** Feed a single char to the per-tab macro trigger detector. */
  feedTrigger?: (tabId: string, char: string) => TriggerMatch | null
  /** Expand a matched macro and inject it into the PTY (erase + paste + cursor). */
  expandMacro?: (tabId: string, match: TriggerMatch) => void
  /** Reset detector state when input boundaries change (paste start, mode toggle). */
  resetTrigger?: (tabId: string) => void
  /**
   * Called for every keystroke immediately after a macro expansion: if the
   * keystroke is a backspace, erase the entire expansion and return true.
   * Any other keystroke clears the pending-undo state and returns false.
   */
  tryConsumeMacroUndo?: (tabId: string, sequence: string) => boolean
}): (sequence: string) => boolean {
  let bracketedPasteBuffer: string | null = null

  function isFocusReportSequence(sequence: string): boolean {
    return sequence === FOCUS_IN_SEQUENCE || sequence === FOCUS_OUT_SEQUENCE
  }

  function flushPaste(tabId: string, payload: string): void {
    logInputDebug('raw.flushPaste', {
      bracketedPasteModeEnabled: deps.getBracketedPasteModeEnabled(),
      payloadLength: payload.length,
      payloadPreview: payload.slice(0, 120),
      tabId,
    })
    deps.writeToPty(tabId, buildPtyPastePayload(payload, deps.getBracketedPasteModeEnabled()), {
      autoBottom: true,
    })
  }

  function handleTerminalShortcut(sequence: string): boolean {
    const chord = rawSequenceToChord(sequence)
    if (chord === null) return false
    return deps.handleTerminalShortcut(chord)
  }

  function handleSequence(tabId: string, sequence: string): boolean {
    if (sequence.length === 0) {
      return true
    }

    if (bracketedPasteBuffer !== null) {
      logInputDebug('raw.collectPasteChunk', {
        chunkLength: sequence.length,
        chunkPreview: sequence.slice(0, 120),
        tabId,
      })
      const endIndex = sequence.indexOf(BRACKETED_PASTE_END)
      if (endIndex === -1) {
        bracketedPasteBuffer += sequence
        return true
      }

      bracketedPasteBuffer += sequence.slice(0, endIndex)
      flushPaste(tabId, bracketedPasteBuffer)
      bracketedPasteBuffer = null
      return handleSequence(tabId, sequence.slice(endIndex + BRACKETED_PASTE_END.length))
    }

    const startIndex = sequence.indexOf(BRACKETED_PASTE_START)
    if (startIndex !== -1) {
      logInputDebug('raw.detectBracketedPasteStart', {
        sequenceLength: sequence.length,
        sequencePreview: sequence.slice(0, 120),
        tabId,
      })
      deps.resetTrigger?.(tabId)
      if (!handleSequence(tabId, sequence.slice(0, startIndex))) {
        return false
      }

      const afterStart = sequence.slice(startIndex + BRACKETED_PASTE_START.length)
      const endIndex = afterStart.indexOf(BRACKETED_PASTE_END)
      if (endIndex === -1) {
        bracketedPasteBuffer = afterStart
        return true
      }

      flushPaste(tabId, afterStart.slice(0, endIndex))
      return handleSequence(tabId, afterStart.slice(endIndex + BRACKETED_PASTE_END.length))
    }

    if (deps.tryConsumeMacroUndo?.(tabId, sequence) ?? false) {
      return true
    }

    if (
      sequence.length === 1 &&
      deps.feedTrigger &&
      deps.expandMacro &&
      !(deps.getIsAlternateBuffer?.() ?? false)
    ) {
      const match = deps.feedTrigger(tabId, sequence)
      if (match) {
        deps.expandMacro(tabId, match)
        return true
      }
    }

    if (handleTerminalShortcut(sequence)) {
      return true
    }

    const normalized = normalizeControlSequence(sequence)
    if (normalized === null) {
      logInputDebug('raw.swallowHostModifier', {
        sequencePreview: sequence.slice(0, 40),
        tabId,
      })
      return true
    }

    deps.writeToPty(tabId, normalized, { autoBottom: !isFocusReportSequence(normalized) })
    return true
  }

  return (sequence: string): boolean => {
    if (deps.getFocusMode() !== 'terminal-input') {
      return false
    }

    logInputDebug('raw.sequence', {
      activeTabId: deps.getActiveTabId(),
      sequenceLength: sequence.length,
      sequencePreview: sequence.slice(0, 120),
    })

    if (handleTerminalShortcut(sequence)) {
      return true
    }

    const activeTabId = deps.getActiveTabId()
    if (!(activeTabId != null && activeTabId !== '')) {
      return false
    }

    return handleSequence(activeTabId, sequence)
  }
}

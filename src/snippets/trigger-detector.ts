import type { SnippetRecord } from '../state/types'

/**
 * Inline trigger detector for snippet/macro expansion.
 *
 * State machine (per-tab):
 *   Idle ──(trigger char)──▶ Capturing
 *   Capturing ──(separator)──▶ try match → return or reset → Idle
 *   Capturing ──(printable char)──▶ append (max 32 chars)
 *   Capturing ──(non-printable / control / escape)──▶ reset → Idle
 *   Capturing ──(trigger char again)──▶ restart Capturing
 *
 * Paste heuristic: if two `feed` calls land within 5ms, treat as paste
 * (sometimes terminals don't enable bracketed paste) and reset.
 */

const MAX_TRIGGER_BUFFER = 32
const SEPARATOR_RE = /[\s.,;:!?)\]}]/u
const PRINTABLE_RE = /^[\x20-\x7e]$/
const PASTE_WINDOW_MS = 5

export interface TriggerMatch {
  snippet: SnippetRecord
  /** Characters typed since trigger char (inclusive), including the closing separator. */
  triggerText: string
}

export interface TriggerDetector {
  feed(char: string): TriggerMatch | null
  reset(): void
}

export interface TriggerDetectorOptions {
  getSnippets: () => readonly SnippetRecord[]
  getTriggerChar: () => string
  now?: () => number
}

export function createTriggerDetector(opts: TriggerDetectorOptions): TriggerDetector {
  const now = opts.now ?? (() => Date.now())
  let capturing = false
  let buffer = ''
  let lastFeedAt = 0

  function reset(): void {
    capturing = false
    buffer = ''
  }

  function tryMatch(separator: string): TriggerMatch | null {
    const triggerChar = opts.getTriggerChar()
    for (const snippet of opts.getSnippets()) {
      if (snippet.trigger && snippet.trigger === buffer) {
        const triggerText = `${triggerChar}${buffer}${separator}`
        reset()
        return { snippet, triggerText }
      }
    }
    reset()
    return null
  }

  return {
    feed(char: string): TriggerMatch | null {
      const t = now()
      const isPaste = capturing && t - lastFeedAt < PASTE_WINDOW_MS && buffer.length > 0
      lastFeedAt = t

      if (isPaste) {
        reset()
        return null
      }

      const triggerChar = opts.getTriggerChar()

      if (char === triggerChar) {
        capturing = true
        buffer = ''
        return null
      }

      if (!capturing) return null

      if (SEPARATOR_RE.test(char)) {
        if (buffer.length === 0) {
          reset()
          return null
        }
        return tryMatch(char)
      }

      if (!PRINTABLE_RE.test(char)) {
        reset()
        return null
      }

      buffer += char
      if (buffer.length > MAX_TRIGGER_BUFFER) {
        reset()
      }
      return null
    },
    reset,
  }
}

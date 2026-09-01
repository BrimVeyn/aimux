// Decides whether a submitted prompt says anything about what the tab is for.
//
// The first Enter in an assistant tab is very often not a task: a trust-folder
// dialog, a theme picker, a slash-command menu, a permission answer, or a bare
// "y". Titling from those is the "renamed too early / wrong intent" failure, so
// they are skipped — and skipping is free: it never consumes a rename attempt.

import { usesUnspacedScript } from './title-format'

/** Answers that only advance a dialog; never a description of the work. */
const CONFIRMATIONS: ReadonlySet<string> = new Set([
  'a',
  'accept',
  'again',
  'allow',
  'annuler',
  'cancel',
  'continue',
  'continue please',
  'd',
  'do it',
  'encore',
  'exit',
  'go',
  'go ahead',
  'go on',
  'k',
  'merci',
  'n',
  'next',
  'no',
  'non',
  'nope',
  'ok',
  'okay',
  'oui',
  'proceed',
  'quit',
  'retry',
  'skip',
  'stop',
  'sure',
  'thanks',
  'thank you',
  'undo',
  'vas-y',
  'y',
  'yep',
  'yes',
  'yes please',
])

/** `/model`, `/init`, `/clear`… — a command, not a request. `/home/x/y.ts` is not one. */
const SLASH_COMMAND = /^\/[a-z][\w:-]*(?:\s|$)/iu
/** `!ls -la` runs a shell command in Claude Code. */
const SHELL_ESCAPE = /^!/u
/** `#` memorizes a note in Claude Code. */
const MEMORY_NOTE = /^#/u

export type PromptVerdict = 'title-worthy' | 'skip'

export function classifyPrompt(prompt: string, minWords: number): PromptVerdict {
  const trimmed = prompt.trim()
  if (trimmed === '') return 'skip'
  if (SLASH_COMMAND.test(trimmed) || SHELL_ESCAPE.test(trimmed) || MEMORY_NOTE.test(trimmed)) {
    return 'skip'
  }

  const normalized = trimmed
    .replaceAll(/\s+/gu, ' ')
    .replace(/[.!?,;:…]+$/u, '')
    .toLowerCase()
  if (CONFIRMATIONS.has(normalized)) return 'skip'
  // Menu selections: a lone digit, or "1" / "2." style picks.
  if (/^\d{1,2}$/u.test(normalized)) return 'skip'

  // Languages without spaces between words defeat the word count; fall back to
  // a character floor so Japanese or Chinese prompts are not all skipped.
  if (usesUnspacedScript(trimmed)) return trimmed.length >= 4 ? 'title-worthy' : 'skip'

  return trimmed.split(/\s+/u).filter(Boolean).length >= minWords ? 'title-worthy' : 'skip'
}

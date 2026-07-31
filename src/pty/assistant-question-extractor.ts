/**
 * Question / permission extraction.
 *
 * When a tab transitions into `waiting-input`, the status detection loop calls
 * this to turn "the worker is blocked" into a structured event: what it's
 * asking (the captured prompt text — authoritative) plus a best-effort parse
 * of the choice list. It reuses the detector's tail extraction so both read
 * the screen identically.
 *
 * Option parsing is explicitly best-effort and per-CLI: TUIs render menus in
 * shapes that shift between versions. `prompt` is always populated; `options`
 * may be absent even when the screen clearly offers choices. Consumers should
 * treat `prompt` as the source of truth and `options` as a convenience.
 */
import type { AssistantId, QuestionKind, TerminalSnapshot } from '../state/types'

import { extractTailLines } from './assistant-status-detector'

/** How many trailing non-blank lines to capture as the prompt text. Wider than
 *  the 10-line classification tail so a multi-line permission block or a long
 *  question is captured whole. */
const PROMPT_TAIL_LINES = 20

export interface QuestionDetail {
  kind: QuestionKind
  /** The captured waiting-input tail, trailing-trimmed, joined with newlines. */
  prompt: string
  /** Best-effort parsed choice list; omitted when none could be recognised. */
  options?: string[]
}

/**
 * Substrings that mark a blocked prompt as a permission / approval request
 * rather than a free-form question. Lower-cased haystack match. Kept broad and
 * shared across CLIs; per-CLI extras are folded in below.
 */
const PERMISSION_SIGNALS: readonly string[] = [
  'do you want',
  'permission required',
  'permission to',
  '△ permission',
  'allow this',
  'approve',
  'pprove', // Grok stylized plan approval "[ a ] pprove ..."
  'grant',
  'press enter to confirm',
  // Kimi Code CLI approval panel titles
  'run this command?',
  'write this file?',
  'apply these edits?',
  'ready to build with this plan?',
  'approve for project',
  'stop this task?',
]

/**
 * Extract the structured question for a tab already classified as
 * `waiting-input`. Returns null only when there's no viewport / no text to
 * report; otherwise `prompt` is always present.
 */
export function extractQuestion(
  assistant: AssistantId,
  viewport: TerminalSnapshot | undefined
): QuestionDetail | null {
  if (!viewport) return null
  const lines = extractTailLines(viewport, PROMPT_TAIL_LINES)
  if (lines.length === 0) return null

  const prompt = lines.join('\n')
  const haystack = prompt.toLowerCase()
  const kind = detectKind(assistant, haystack)
  const options = parseOptions(lines, haystack)
  return options ? { kind, options, prompt } : { kind, prompt }
}

function detectKind(assistant: AssistantId, haystack: string): QuestionKind {
  for (const signal of PERMISSION_SIGNALS) {
    if (haystack.includes(signal)) return 'permission'
  }
  // opencode surfaces tool approvals under a "permission" banner; codex uses an
  // approval confirm. Both already covered by the shared signals, but keep the
  // assistant param so future per-CLI divergence has a seam.
  void assistant
  return 'question'
}

/**
 * Matches a numbered menu row: an optional selection marker (❯ › > *), a digit,
 * a `.`/`)` separator, then the option label. Capturing the label lets us strip
 * the marker/number so consumers get clean text.
 */
const NUMBERED_OPTION = /^\s*[❯›>*]?\s*\d+[.)]\s+(\S.*)$/u

/**
 * Matches an arrow-selected label with no number, e.g. Claude's `❯ Yes` /
 * `  No` yes-no menus.
 */
const MARKED_OPTION = /^\s*[❯›]\s+(\S.*)$/u

function parseOptions(lines: readonly string[], haystack: string): string[] | undefined {
  const numbered: string[] = []
  for (const line of lines) {
    const captured = NUMBERED_OPTION.exec(line)?.[1]
    if (captured != null && captured !== '') numbered.push(captured.trimEnd())
  }
  if (numbered.length >= 2) return numbered

  // No numbered menu — look for a single arrow-marked choice paired with its
  // siblings is unreliable, so fall back to explicit yes/no affordances.
  if (
    haystack.includes('[y/n]') ||
    haystack.includes('(y/n)') ||
    haystack.includes('yes/no') ||
    haystack.includes('y/n?')
  ) {
    return ['Yes', 'No']
  }

  const marked = lines.map((line) => MARKED_OPTION.exec(line)?.[1]?.trimEnd()).filter(isNonEmpty)
  if (marked.length >= 1 && numbered.length === 0) {
    // A lone highlighted option (e.g. a confirm dialog defaulting to Yes) — only
    // surface it when it's a short label, not a highlighted sentence.
    const short = marked.filter((label) => label.length <= 40)
    if (short.length >= 1) return short
  }

  return undefined
}

function isNonEmpty(value: string | undefined): value is string {
  return value !== undefined && value.length > 0
}

/**
 * Assistant status detection.
 *
 * Per-CLI content heuristics are adapted from herdr by @ogulcancelik
 * (https://github.com/ogulcancelik/herdr, MIT). Rule tables trace back to
 * `src/detect.rs` in that repo.
 *
 * The detector classifies a terminal project as `working`, `waiting-input`,
 * or `idle`. Built-in CLIs (claude, codex, opencode, grok, kimi) have dedicated
 * classify* functions. Custom CLIs fall back to a generic heuristic that
 * (a) recognises common shells as always-idle and (b) uses pane-tail change
 * velocity plus generic y/n / confirm prompt patterns.
 */
import type { AssistantId, TabActivity, TerminalSnapshot } from '../state/types'

import { getLineText } from '../input/terminal-text-extraction'

const TAIL_LINE_COUNT = 10
const ACTIVE_CHANGE_WINDOW_MS = 600

/** Spinner glyphs used by claude code's status lines. */
const CLAUDE_SPINNER_GLYPHS = '·✱✲✳✴✵✶✷✸✹✺✻✼✽✾✿❀❁❂❃❇❈❉❊❋✢✣✤✥✦✧✨⊛⊕⊙◉◎◍⁂⁕※⍟☼★☆'
const CLAUDE_SPINNER_GLYPH_SET = new Set(CLAUDE_SPINNER_GLYPHS)

const SHELL_COMMAND_PATTERN =
  /(^|\/)(bash|zsh|fish|sh|dash|ash|ksh|tcsh|csh|nu|pwsh|powershell|elvish|xonsh)(\.exe)?$/i

interface DetectorEntry {
  tail: string
  changedAt: number
  status: TabActivity
}

export interface DetectStatusInput {
  tabId: string
  assistant: AssistantId
  /** The raw command string (first token matters for shell detection). */
  command?: string
  viewport: TerminalSnapshot | undefined
  /** Override the clock for tests. Defaults to Date.now. */
  now?: number
}

export class AssistantStatusDetector {
  private readonly entries = new Map<string, DetectorEntry>()

  classify(input: DetectStatusInput): TabActivity {
    const { assistant, command, tabId, viewport } = input
    const now = input.now ?? Date.now()

    if (!viewport) return this.remember(tabId, '', now, 'idle')

    const tail = extractTailText(viewport, TAIL_LINE_COUNT)
    const prev = this.entries.get(tabId)
    const changedAt = prev && prev.tail === tail ? prev.changedAt : now
    const haystack = tail.toLowerCase()

    if (assistant === 'terminal' || isShellCommand(command)) {
      return this.remember(tabId, tail, changedAt, 'idle')
    }

    const perCli = classifyBuiltin(assistant, haystack, tail)
    if (perCli) return this.remember(tabId, tail, changedAt, perCli)

    const generic = classifyGeneric(haystack, changedAt, now)
    return this.remember(tabId, tail, changedAt, generic)
  }

  forget(tabId: string): void {
    this.entries.delete(tabId)
  }

  clear(): void {
    this.entries.clear()
  }

  private remember(
    tabId: string,
    tail: string,
    changedAt: number,
    status: TabActivity
  ): TabActivity {
    this.entries.set(tabId, { changedAt, status, tail })
    return status
  }
}

/**
 * Last `lineCount` non-blank rendered lines, trailing-trimmed, oldest-first.
 * Shared by the status detector (10-line tail for classification) and the
 * question extractor (larger tail for prompt capture) so both read the screen
 * the same way. Prefers `tailLines` when the user has scrolled the viewport
 * off the active screen.
 */
export function extractTailLines(viewport: TerminalSnapshot, lineCount: number): string[] {
  const isScrolledToBottom = viewport.viewportY === viewport.baseY
  const lines = isScrolledToBottom ? viewport.lines : (viewport.tailLines ?? viewport.lines)
  // Full-screen TUIs (claude, opencode, grok) paint in the alternate buffer and
  // often leave the last rows blank, putting their status bar higher up.
  // Skip trailing blank rows before taking the last `lineCount`.
  let end = lines.length
  while (end > 0) {
    const line = lines[end - 1]
    if (!line) {
      end--
      continue
    }
    const text = getLineText(line).trim()
    if (text.length === 0) {
      end--
      continue
    }
    break
  }
  const start = Math.max(0, end - lineCount)
  const parts: string[] = []
  for (let i = start; i < end; i++) {
    const line = lines[i]
    if (!line) continue
    parts.push(getLineText(line).replace(/\s+$/u, ''))
  }
  return parts
}

function extractTailText(viewport: TerminalSnapshot, lineCount: number): string {
  return extractTailLines(viewport, lineCount).join('\n')
}

function classifyBuiltin(
  assistant: AssistantId,
  haystack: string,
  rawTail: string
): TabActivity | null {
  switch (assistant) {
    case 'claude':
      return classifyClaude(haystack, rawTail)
    case 'codex':
      return classifyCodex(haystack)
    case 'opencode':
      return classifyOpencode(haystack)
    case 'grok':
      return classifyGrok(haystack, rawTail)
    case 'kimi':
      return classifyKimi(haystack, rawTail)
    default:
      return null
  }
}

function classifyClaude(haystack: string, rawTail: string): TabActivity {
  if (
    haystack.includes('do you want') ||
    haystack.includes('would you like') ||
    haystack.includes('tab to amend') ||
    haystack.includes('enter to select') ||
    (haystack.includes('esc to cancel') && haystack.includes('to navigate'))
  ) {
    return 'waiting-input'
  }
  if (
    haystack.includes('esc/ctrl+c to interrupt') ||
    haystack.includes('esc to interrupt') ||
    haystack.includes('ctrl+c to interrupt') ||
    haystack.includes('esc interrupt')
  ) {
    return 'working'
  }
  if (hasClaudeSpinner(rawTail)) return 'working'
  return 'idle'
}

// A real spinner line looks like `✱ Thinking…`: glyph at the line start, with
// the ellipsis on the same line. Anchoring to the line start rejects the `·`
// separators Claude scatters mid-line through its header/footer (e.g.
// `Opus 4.7 … · Claude Max`, `… · ← for agents`), which would otherwise pair
// with a stray `...` placeholder and mark an idle home screen as working.
function hasClaudeSpinner(rawTail: string): boolean {
  for (const line of rawTail.split('\n')) {
    const trimmed = line.trimStart()
    const first = trimmed[0]
    if (first == null || !CLAUDE_SPINNER_GLYPH_SET.has(first)) continue
    if (trimmed.includes('…') || trimmed.includes('...')) return true
  }
  return false
}

function classifyCodex(haystack: string): TabActivity {
  if (
    haystack.includes('press enter to confirm') ||
    haystack.includes('[y/n]') ||
    haystack.includes('enter to submit answer')
  ) {
    return 'waiting-input'
  }
  if (haystack.includes('esc to interrupt') || haystack.includes('• working (')) {
    return 'working'
  }
  return 'idle'
}

function classifyOpencode(haystack: string): TabActivity {
  if (
    haystack.includes('permission required') ||
    haystack.includes('△ permission') ||
    (haystack.includes('enter submit') && haystack.includes('esc dismiss'))
  ) {
    return 'waiting-input'
  }
  if (
    haystack.includes('esc interrupt') ||
    haystack.includes('esc to interrupt') ||
    haystack.includes('esc again to interrupt')
  ) {
    return 'working'
  }
  return 'idle'
}

function classifyGrok(haystack: string, _rawTail: string): TabActivity {
  // Waiting for user decision / input (plan approval, Q&A, permissions, confirms).
  // These are the distinctive Grok Build TUI states that must produce 'waiting-input'
  // so the rest of the system (turn lifecycle, question events, UI chips, orchestrators)
  // treats grok the same as claude/codex/opencode.
  if (
    haystack.includes('waiting on answers') ||
    haystack.includes('pprove') || // stylized "[ a ] pprove [ c ] omment [ q ] uit plan"
    haystack.includes('omment') ||
    haystack.includes('uit plan') ||
    (haystack.includes('approve') &&
      (haystack.includes('comment') || haystack.includes('quit') || haystack.includes('plan'))) ||
    haystack.includes('enter :select') ||
    haystack.includes('enter to select') ||
    haystack.includes('enter submit') ||
    haystack.includes('do you want') ||
    haystack.includes('would you like') ||
    haystack.includes('permission required') ||
    haystack.includes('permission to') ||
    haystack.includes('approve?') ||
    haystack.includes('allow?')
  ) {
    return 'waiting-input'
  }

  // Agent actively reasoning or executing (mirrors claude spinner + interrupt logic).
  // "Thought for Xs" is the primary visible trace while Grok thinks/plans.
  if (
    haystack.includes('thought for') || // "Thought for 3.4s", etc.
    haystack.includes('thinking…') ||
    haystack.includes('thinking ...') ||
    haystack.includes('esc to interrupt') ||
    haystack.includes('esc interrupt') ||
    haystack.includes('esc: interrupt')
  ) {
    return 'working'
  }

  return 'idle'
}

/** Braille spinner frames used by Kimi Code CLI (`BRAILLE_SPINNER_FRAMES`). */
const KIMI_BRAILLE_SPINNER = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
/** Moon-phase spinner frames used by Kimi Code CLI (`MOON_SPINNER_FRAMES`). */
const KIMI_MOON_SPINNER = '🌑🌒🌓🌔🌕🌖🌗🌘'

/**
 * Kimi Code CLI status heuristics from the official TUI:
 * - Approval panel titles/footers → waiting-input
 * - Braille/moon spinners, `working...`, rotating tips → working
 */
function classifyKimi(haystack: string, rawTail: string): TabActivity {
  // Tool / plan approval panel (apps/kimi-code approval-panel.ts headers + footer).
  if (
    haystack.includes('run this command?') ||
    haystack.includes('write this file?') ||
    haystack.includes('apply these edits?') ||
    haystack.includes('stop this task?') ||
    haystack.includes('ready to build with this plan?') ||
    haystack.includes('approve for project') ||
    haystack.includes('approve for this project') ||
    haystack.includes('type feedback') ||
    haystack.includes('waiting for authorization') ||
    haystack.includes('sign in to kimi') ||
    haystack.includes('do you want') ||
    haystack.includes('would you like') ||
    haystack.includes('permission required') ||
    haystack.includes('permission to') ||
    haystack.includes('approve?') ||
    haystack.includes('allow?') ||
    // Generic "Approve <Tool>?" header, e.g. "▶ Approve Bash?"
    (haystack.includes('approve ') && haystack.includes('?')) ||
    // Distinctive panel chrome: "↑/↓ select · 1/2 choose · ↵ confirm"
    haystack.includes('↑/↓ select') ||
    haystack.includes('↵ confirm')
  ) {
    return 'waiting-input'
  }

  // Agent actively streaming / calling tools.
  // Anchor thinking on ellipsis so the footer model suffix "thinking" alone
  // (e.g. "kimi-k2 thinking") does not mark an idle project as working.
  if (
    haystack.includes('working...') ||
    haystack.includes('working…') ||
    haystack.includes(' · tip:') ||
    haystack.includes('thinking…') ||
    haystack.includes('thinking...') ||
    hasKimiSpinner(rawTail)
  ) {
    return 'working'
  }

  return 'idle'
}

function hasKimiSpinner(rawTail: string): boolean {
  for (const ch of rawTail) {
    if (KIMI_BRAILLE_SPINNER.includes(ch) || KIMI_MOON_SPINNER.includes(ch)) return true
  }
  return false
}

const GENERIC_WAITING_PATTERNS: string[] = [
  '[y/n]',
  '(y/n)',
  'yes/no',
  'y/n?',
  'confirm?',
  'continue?',
  'proceed?',
  'press enter to continue',
  'press any key',
  'allow?',
  'approve?',
  'do you want',
  'would you like',
  'permission required',
  'enter to select',
]

function classifyGeneric(haystack: string, changedAt: number, now: number): TabActivity {
  for (const pattern of GENERIC_WAITING_PATTERNS) {
    if (haystack.includes(pattern)) return 'waiting-input'
  }
  if (now - changedAt < ACTIVE_CHANGE_WINDOW_MS) return 'working'
  return 'idle'
}

export function isShellCommand(command: string | undefined): boolean {
  if (!(command != null && command !== '')) return false
  const first = command.trim().split(/\s+/u)[0]
  if (!(first != null && first !== '')) return false
  return SHELL_COMMAND_PATTERN.test(first)
}

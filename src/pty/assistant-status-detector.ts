/**
 * Assistant status detection.
 *
 * Per-CLI content heuristics are adapted from herdr by @ogulcancelik
 * (https://github.com/ogulcancelik/herdr, MIT). Rule tables trace back to
 * `src/detect.rs` in that repo.
 *
 * The detector classifies a terminal session as `working`, `waiting-input`,
 * or `idle`. Built-in CLIs (claude, codex, opencode) use per-CLI substring
 * tables. Custom CLIs fall back to a generic heuristic that (a) recognises
 * common shells as always-idle and (b) uses pane-tail change velocity plus
 * generic y/n / confirm prompt patterns.
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

function extractTailText(viewport: TerminalSnapshot, lineCount: number): string {
  const isScrolledToBottom = viewport.viewportY === viewport.baseY
  const lines = isScrolledToBottom ? viewport.lines : (viewport.tailLines ?? viewport.lines)
  // Full-screen TUIs (claude, opencode) paint in the alternate buffer and
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
  return parts.join('\n')
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

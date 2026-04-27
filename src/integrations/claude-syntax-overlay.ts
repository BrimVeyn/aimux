// Beta POC — re-tokenize Claude's diff lines with shiki using the active
// aimux theme. Runs on the App side after each PTY snapshot arrives, so
// shiki + theme access stay in the React process (the daemon doesn't carry
// the user theme).
//
// Heuristic: a line is "diff-ish" when its dominant non-space-cell bg
// matches the resolved theme's `diffAddedBg` / `diffRemovedBg`. We strip a
// possible "<lineno> <marker> " prefix, tokenize the rest as TypeScript
// (best-effort fallback), and rebuild spans preserving the original bg.
//
// Limits: language is hardcoded; no detection of Claude's full code-box
// (we only retint the diff regions); fragile against Claude UI changes.

import type { TerminalLine, TerminalSnapshot, TerminalSpan } from '../state/types'

import { ensureActiveShikiTheme, ensureShikiLang, getShikiHighlighter } from '../ui/shiki'
import { getCurrentMode, getCurrentTheme } from '../ui/theme'

const DEFAULT_LANG = 'typescript'

// Sync handle populated once shiki finishes loading. Until then,
// `highlightSnapshot` is a no-op.
let ready = false
let activeThemeName: string | null = null

export async function warmClaudeSyntaxOverlay(): Promise<void> {
  try {
    const h = await getShikiHighlighter()
    const [langOk, themeName] = await Promise.all([
      ensureShikiLang(h, DEFAULT_LANG),
      ensureActiveShikiTheme(h),
    ])
    if (!langOk) return
    activeThemeName = themeName
    ready = true
  } catch {
    // best-effort
  }
}

const PREFIX_RE = /^(\s*\d+\s+[+-]?\s+)/

interface DiffKind {
  kind: 'added' | 'removed'
  bg: string
}

function detectDiffKind(line: TerminalLine, addedBg: string, removedBg: string): DiffKind | null {
  // Pick the dominant bg among non-blank cells.
  const counts = new Map<string, number>()
  for (const span of line.spans) {
    if (!span.bg) continue
    if (span.text.trim().length === 0) continue
    counts.set(span.bg, (counts.get(span.bg) ?? 0) + span.text.length)
  }
  let best: string | null = null
  let bestCount = 0
  for (const [bg, c] of counts) {
    if (c > bestCount) {
      best = bg
      bestCount = c
    }
  }
  if (!best) return null
  if (best.toLowerCase() === addedBg.toLowerCase()) return { bg: best, kind: 'added' }
  if (best.toLowerCase() === removedBg.toLowerCase()) return { bg: best, kind: 'removed' }
  return null
}

function lineText(line: TerminalLine): string {
  return line.spans.map((s) => s.text).join('')
}

interface ShikiToken {
  content: string
  color?: string
  fontStyle?: number
}

function tokenize(code: string): ShikiToken[][] {
  if (!ready || !activeThemeName) return []
  // We loaded shiki async earlier; the highlighter promise is resolved by
  // now. Read the resolved value via a sync re-call — getShikiHighlighter()
  // is memoized, but it returns a Promise. We rely on the fact that
  // `await`-ed once during warm-up, the promise's `.then` handler ran. To
  // get the sync value, we cache it on warm.
  const highlighter = warmedHighlighter
  if (!highlighter) return []
  try {
    /* eslint-disable typescript-eslint/no-explicit-any */
    return highlighter.codeToTokens(code, {
      lang: DEFAULT_LANG as any,
      theme: activeThemeName as any,
    }).tokens as ShikiToken[][]
    /* eslint-enable typescript-eslint/no-explicit-any */
  } catch {
    return []
  }
}

// Cache the resolved highlighter for sync access.
let warmedHighlighter: Awaited<ReturnType<typeof getShikiHighlighter>> | null = null
void getShikiHighlighter().then((h) => {
  warmedHighlighter = h
})

function rebuildLine(line: TerminalLine, bg: string, fallbackFg: string): TerminalLine | null {
  const text = lineText(line)
  const prefixMatch = text.match(PREFIX_RE)
  const prefix = prefixMatch ? prefixMatch[0] : ''
  const code = text.slice(prefix.length)
  if (code.trim().length === 0) return null

  const tokenLines = tokenize(code)
  if (tokenLines.length === 0) return null
  const tokens = tokenLines[0] ?? []
  if (tokens.length === 0) return null

  const spans: TerminalSpan[] = []
  if (prefix.length > 0) {
    spans.push({ bg, fg: fallbackFg, text: prefix })
  }
  for (const tok of tokens) {
    if (!tok.content) continue
    const fs = tok.fontStyle ?? 0
    spans.push({
      bg,
      bold: (fs & 2) !== 0 || undefined,
      fg: tok.color ?? fallbackFg,
      italic: (fs & 1) !== 0 || undefined,
      text: tok.content,
      underline: (fs & 4) !== 0 || undefined,
    })
  }
  return { spans }
}

function processLines(
  lines: TerminalLine[],
  addedBg: string,
  removedBg: string,
  fallbackFg: string
): TerminalLine[] {
  let changed = false
  const out: TerminalLine[] = lines.map((line) => {
    const kind = detectDiffKind(line, addedBg, removedBg)
    if (!kind) return line
    const rebuilt = rebuildLine(line, kind.bg, fallbackFg)
    if (!rebuilt) return line
    changed = true
    return rebuilt
  })
  return changed ? out : lines
}

export function highlightSnapshot(snapshot: TerminalSnapshot): TerminalSnapshot {
  if (!ready || !warmedHighlighter) return snapshot

  // Re-resolve theme on every call — cheap and keeps the overlay reactive
  // to theme switches without an explicit subscription.
  const theme = getCurrentTheme()
  // Mode unused; kept for future per-mode tweaks.
  void getCurrentMode()
  const addedBg = theme.diffAddedBg
  const removedBg = theme.diffRemovedBg
  const fallbackFg = theme.text

  const nextLines = processLines(snapshot.lines, addedBg, removedBg, fallbackFg)
  const nextTail = snapshot.tailLines
    ? processLines(snapshot.tailLines, addedBg, removedBg, fallbackFg)
    : snapshot.tailLines
  if (nextLines === snapshot.lines && nextTail === snapshot.tailLines) return snapshot
  return { ...snapshot, lines: nextLines, tailLines: nextTail }
}

// Beta POC — re-tokenize Claude's tool-output code lines with shiki using
// the active aimux theme. Runs on the App side after each PTY snapshot
// arrives; shiki + theme stay in the React process.
//
// Two structural signals drive detection:
//   1. Tool header (e.g. `⏺ Update(src/foo.ts)`) → file path → language.
//   2. Code lines always start with a number prefix (` 42  `, ` 42  + `,
//      ` 42  - `). That prefix marks where to slice + how long the block runs.
//
// Per-tab state remembers the last seen language so blocks whose header
// has scrolled off the viewport still get colored correctly.
//
// Limits: language inference relies on the header staying visible at least
// once; languages outside the pre-loaded set fall back to plain text.

import type { TerminalLine, TerminalSnapshot, TerminalSpan } from '../state/types'

import { ensureActiveShikiTheme, ensureShikiLang, getShikiHighlighter } from '../ui/shiki'
import { getCurrentTheme } from '../ui/theme'

const DEFAULT_LANG = 'typescript'

const PRELOAD_LANGS = [
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'python',
  'go',
  'rust',
  'bash',
  'shellscript',
  'json',
  'yaml',
  'markdown',
  'html',
  'css',
  'scss',
  'java',
  'c',
  'cpp',
  'ruby',
  'php',
  'sql',
  'lua',
  'swift',
  'kotlin',
  'toml',
  'xml',
] as const

const EXT_TO_LANG: Record<string, string> = {
  c: 'c',
  cc: 'cpp',
  cjs: 'javascript',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  cxx: 'cpp',
  go: 'go',
  h: 'c',
  hpp: 'cpp',
  hs: 'haskell',
  htm: 'html',
  html: 'html',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsx: 'jsx',
  kt: 'kotlin',
  kts: 'kotlin',
  lua: 'lua',
  md: 'markdown',
  mjs: 'javascript',
  php: 'php',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  scss: 'scss',
  sh: 'bash',
  sql: 'sql',
  swift: 'swift',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'bash',
}

let ready = false
let activeThemeName: string | null = null
let warmedHighlighter: Awaited<ReturnType<typeof getShikiHighlighter>> | null = null

// Per-tab last seen language (header may have scrolled off the viewport).
const tabLang = new Map<string, string>()

export async function warmClaudeSyntaxOverlay(): Promise<void> {
  try {
    const h = await getShikiHighlighter()
    warmedHighlighter = h
    const themeName = await ensureActiveShikiTheme(h)
    activeThemeName = themeName
    await Promise.all(PRELOAD_LANGS.map((lang) => ensureShikiLang(h, lang)))
    ready = true
  } catch {
    // best-effort
  }
}

// `⏺ Update(path/to/file.ts)`, `⏺ Read(path)`, `Edit(path)`, `Write(path)`...
// The leading bullet is sometimes a different glyph; we match a wider
// keyword set and look for `<Verb>(<path>)` as the anchor.
const TOOL_HEADER_RE = /\b(?:Read|Update|Edit|Write|MultiEdit|Create|NotebookEdit)\(([^)]+)\)/

// Code-line prefix used by Claude in tool output: ` <n>  ` optionally
// followed by `+ ` / `- ` for diff lines.
//   Group 1 = leading whitespace before the number (kept on the outer
//             dark bg so the diff strip starts at the line number).
//   Group 2 = the digits + spaces + optional diff marker (the gutter that
//             carries the diff bg for `+`/`-` lines).
//   Group 3 = the diff marker itself, present only on `+`/`-` rows.
const PREFIX_RE = /^(\s*)(\d+\s+([+-]\s+)?)/

interface ShikiToken {
  content: string
  color?: string
  fontStyle?: number
}

function inferLangFromPath(path: string): string | null {
  const trimmed = path.trim()
  const dot = trimmed.lastIndexOf('.')
  if (dot <= 0) return null
  const ext = trimmed.slice(dot + 1).toLowerCase()
  return EXT_TO_LANG[ext] ?? null
}

function lineText(line: TerminalLine): string {
  return line.spans.map((s) => s.text).join('')
}

function dominantBg(line: TerminalLine): string | undefined {
  const counts = new Map<string, number>()
  for (const span of line.spans) {
    if (!span.bg) continue
    if (span.text.trim().length === 0) continue
    counts.set(span.bg, (counts.get(span.bg) ?? 0) + span.text.length)
  }
  let best: string | undefined
  let bestCount = 0
  for (const [bg, c] of counts) {
    if (c > bestCount) {
      best = bg
      bestCount = c
    }
  }
  return best
}

function tokenize(code: string, lang: string): ShikiToken[][] {
  if (!ready || !activeThemeName || !warmedHighlighter) return []
  try {
    /* eslint-disable typescript-eslint/no-explicit-any */
    return warmedHighlighter.codeToTokens(code, {
      lang: lang as any,
      theme: activeThemeName as any,
    }).tokens as ShikiToken[][]
    /* eslint-enable typescript-eslint/no-explicit-any */
  } catch {
    return []
  }
}

// Calm palette: only color tokens that carry semantic weight (keywords,
// strings, comments, numbers, types, function names). Operators /
// punctuation / variables fall back to plain `text` so we don't end up
// with a rainbow where every identifier and brace is its own color.
function buildAccentSet(): Set<string> {
  const t = getCurrentTheme()
  return new Set(
    [
      t.syntaxKeyword,
      t.syntaxString,
      t.syntaxComment,
      t.syntaxNumber,
      t.syntaxType,
      t.syntaxFunction,
    ]
      .filter((c): c is string => typeof c === 'string')
      .map((c) => c.toLowerCase())
  )
}

function buildSpans(
  tokens: ShikiToken[],
  bg: string | undefined,
  fallbackFg: string,
  accents: Set<string>
): TerminalSpan[] {
  const spans: TerminalSpan[] = []
  for (const tok of tokens) {
    if (!tok.content) continue
    const fs = tok.fontStyle ?? 0
    const tokColor = tok.color?.toLowerCase()
    const fg = tokColor && accents.has(tokColor) ? tok.color : fallbackFg
    spans.push({
      bg,
      bold: (fs & 2) !== 0 || undefined,
      fg,
      italic: (fs & 1) !== 0 || undefined,
      text: tok.content,
      underline: (fs & 4) !== 0 || undefined,
    })
  }
  return spans
}

function rebuildLine(
  line: TerminalLine,
  leading: string,
  gutter: string,
  isDiff: boolean,
  tokens: ShikiToken[],
  fallbackFg: string,
  codeBlockBg: string,
  accents: Set<string>,
  targetWidth: number
): TerminalLine {
  // Two zones per row:
  //   - leading whitespace before the line number → outer code-block bg.
  //   - gutter + code + right padding → strip bg (diff color for `+`/`-`
  //     lines, code-block bg otherwise).
  // For non-diff lines both zones use the same bg so the row reads as a
  // single rectangle.
  const stripBg = isDiff ? (dominantBg(line) ?? codeBlockBg) : codeBlockBg

  const out: TerminalSpan[] = []
  let consumed = 0
  if (leading.length > 0) {
    const leadingSpans = sliceLeading(line.spans, leading.length)
    for (const span of leadingSpans) {
      out.push({ ...span, bg: codeBlockBg })
    }
    consumed += leading.length
  }
  if (gutter.length > 0) {
    const gutterSpans = sliceRange(line.spans, consumed, gutter.length)
    for (const span of gutterSpans) {
      // Preserve fg / bold / italic (line numbers + diff markers carry
      // meaning); force bg to the strip color.
      out.push({ ...span, bg: stripBg })
    }
    consumed += gutter.length
  }
  out.push(...buildSpans(tokens, stripBg, fallbackFg, accents))

  // Pad the right edge with the strip bg out to `targetWidth`. We use the
  // snapshot's max line width rather than this row's own span length:
  // after a window grow, xterm hasn't yet filled the new columns on
  // existing lines, so per-row width undershoots the viewport width.
  const written = out.reduce((acc, span) => acc + span.text.length, 0)
  if (targetWidth > written) {
    out.push({ bg: stripBg, fg: fallbackFg, text: ' '.repeat(targetWidth - written) })
  }

  return { spans: out }
}

// Return a shallow copy of the spans covering [start, start+count) chars,
// splitting boundary spans as needed.
function sliceRange(spans: TerminalSpan[], start: number, count: number): TerminalSpan[] {
  const out: TerminalSpan[] = []
  let cursor = 0
  let remaining = count
  for (const span of spans) {
    if (remaining <= 0) break
    const next = cursor + span.text.length
    if (next <= start) {
      cursor = next
      continue
    }
    const localStart = Math.max(0, start - cursor)
    const available = span.text.length - localStart
    const take = Math.min(available, remaining)
    out.push({ ...span, text: span.text.slice(localStart, localStart + take) })
    remaining -= take
    cursor = next
  }
  return out
}

// Take spans from the start of `spans` totalling `count` characters,
// splitting the boundary span if needed. Used to keep the gutter
// (line number + diff marker) intact while we replace the code portion.
function sliceLeading(spans: TerminalSpan[], count: number): TerminalSpan[] {
  const out: TerminalSpan[] = []
  let remaining = count
  for (const span of spans) {
    if (remaining <= 0) break
    if (span.text.length <= remaining) {
      out.push(span)
      remaining -= span.text.length
      continue
    }
    out.push({ ...span, text: span.text.slice(0, remaining) })
    remaining = 0
  }
  return out
}

interface BlockContext {
  lang: string
  startIndex: number
  leadings: string[]
  gutters: string[]
  isDiff: boolean[]
  codes: string[]
  lineRefs: TerminalLine[]
}

function flushBlock(
  block: BlockContext,
  lines: TerminalLine[],
  fallbackFg: string,
  codeBlockBg: string,
  accents: Set<string>,
  targetWidth: number
): void {
  if (block.codes.length === 0) return
  const joined = block.codes.join('\n')
  const tokenLines = tokenize(joined, block.lang)
  if (tokenLines.length === 0) return
  for (let i = 0; i < block.lineRefs.length; i += 1) {
    const tokens = tokenLines[i]
    if (!tokens) continue
    const lineRef = block.lineRefs[i]
    const leading = block.leadings[i]
    const gutter = block.gutters[i]
    const isDiff = block.isDiff[i]
    if (!lineRef || leading === undefined || gutter === undefined || isDiff === undefined) {
      continue
    }
    const newLine = rebuildLine(
      lineRef,
      leading,
      gutter,
      isDiff,
      tokens,
      fallbackFg,
      codeBlockBg,
      accents,
      targetWidth
    )
    lines[block.startIndex + i] = newLine
  }
}

function maxLineWidth(lines: TerminalLine[]): number {
  let max = 0
  for (const line of lines) {
    let w = 0
    for (const span of line.spans) w += span.text.length
    if (w > max) max = w
  }
  return max
}

function processLines(
  lines: TerminalLine[],
  tabId: string,
  fallbackFg: string,
  codeBlockBg: string,
  accents: Set<string>,
  targetWidth: number
): TerminalLine[] {
  const out = lines.slice()
  let block: BlockContext | null = null

  for (let i = 0; i < out.length; i += 1) {
    const line = out[i]
    if (!line) continue
    const text = lineText(line)

    // Update per-tab language whenever a tool header appears.
    const headerMatch = text.match(TOOL_HEADER_RE)
    if (headerMatch) {
      const lang = inferLangFromPath(headerMatch[1] ?? '')
      if (lang) tabLang.set(tabId, lang)
    }

    const prefixMatch = text.match(PREFIX_RE)
    if (prefixMatch) {
      const leading = prefixMatch[1] ?? ''
      const gutter = prefixMatch[2] ?? ''
      const diffMarker = prefixMatch[3] ?? ''
      const code = text.slice(leading.length + gutter.length)
      if (!block) {
        block = {
          codes: [],
          gutters: [],
          isDiff: [],
          lang: tabLang.get(tabId) ?? DEFAULT_LANG,
          leadings: [],
          lineRefs: [],
          startIndex: i,
        }
      }
      block.leadings.push(leading)
      block.gutters.push(gutter)
      block.isDiff.push(diffMarker.length > 0)
      block.codes.push(code)
      block.lineRefs.push(line)
      continue
    }

    if (block) {
      flushBlock(block, out, fallbackFg, codeBlockBg, accents, targetWidth)
      block = null
    }
  }

  if (block) flushBlock(block, out, fallbackFg, codeBlockBg, accents, targetWidth)
  return out
}

export function highlightSnapshot(snapshot: TerminalSnapshot, tabId: string): TerminalSnapshot {
  if (!ready || !warmedHighlighter) return snapshot

  const theme = getCurrentTheme()
  const fallbackFg = theme.text
  const codeBlockBg = theme.backgroundElement
  const accents = buildAccentSet()

  // Use the longest non-empty row in the snapshot as the target width.
  // Falls back to a sensible minimum if no row is wide enough yet (very
  // early in render).
  const targetWidth = Math.max(maxLineWidth(snapshot.lines), maxLineWidth(snapshot.tailLines ?? []))
  if (targetWidth === 0) return snapshot

  const nextLines = processLines(
    snapshot.lines,
    tabId,
    fallbackFg,
    codeBlockBg,
    accents,
    targetWidth
  )
  const nextTail = snapshot.tailLines
    ? processLines(snapshot.tailLines, tabId, fallbackFg, codeBlockBg, accents, targetWidth)
    : snapshot.tailLines
  return { ...snapshot, lines: nextLines, tailLines: nextTail }
}

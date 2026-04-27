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
// followed by `+ ` / `- ` for diff lines. The `<n>` is right-aligned in
// a few-char gutter, so leading spaces are normal.
const PREFIX_RE = /^(\s*\d+\s+(?:[+-]\s+)?)/

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
  prefix: string,
  tokens: ShikiToken[],
  fallbackFg: string,
  accents: Set<string>
): TerminalLine {
  const bg = dominantBg(line)
  const out: TerminalSpan[] = []
  if (prefix.length > 0) {
    // Preserve whatever fg/bg/style the prefix already had so line numbers
    // and `+`/`-` markers keep their gutter coloring from Claude.
    const prefixSpans = sliceLeading(line.spans, prefix.length)
    out.push(...prefixSpans)
  }
  out.push(...buildSpans(tokens, bg, fallbackFg, accents))
  return { spans: out }
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
  prefixes: string[]
  codes: string[]
  lineRefs: TerminalLine[]
}

function flushBlock(
  block: BlockContext,
  lines: TerminalLine[],
  fallbackFg: string,
  accents: Set<string>
): void {
  if (block.codes.length === 0) return
  const joined = block.codes.join('\n')
  const tokenLines = tokenize(joined, block.lang)
  if (tokenLines.length === 0) return
  for (let i = 0; i < block.lineRefs.length; i += 1) {
    const tokens = tokenLines[i]
    if (!tokens) continue
    const lineRef = block.lineRefs[i]
    const prefix = block.prefixes[i]
    if (!lineRef || prefix === undefined) continue
    const newLine = rebuildLine(lineRef, prefix, tokens, fallbackFg, accents)
    lines[block.startIndex + i] = newLine
  }
}

function processLines(
  lines: TerminalLine[],
  tabId: string,
  fallbackFg: string,
  accents: Set<string>
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
      const prefix = prefixMatch[0]
      const code = text.slice(prefix.length)
      if (!block) {
        block = {
          codes: [],
          lang: tabLang.get(tabId) ?? DEFAULT_LANG,
          lineRefs: [],
          prefixes: [],
          startIndex: i,
        }
      }
      block.prefixes.push(prefix)
      block.codes.push(code)
      block.lineRefs.push(line)
      continue
    }

    if (block) {
      flushBlock(block, out, fallbackFg, accents)
      block = null
    }
  }

  if (block) flushBlock(block, out, fallbackFg, accents)
  return out
}

export function highlightSnapshot(snapshot: TerminalSnapshot, tabId: string): TerminalSnapshot {
  if (!ready || !warmedHighlighter) return snapshot

  const theme = getCurrentTheme()
  const fallbackFg = theme.text
  const accents = buildAccentSet()

  const nextLines = processLines(snapshot.lines, tabId, fallbackFg, accents)
  const nextTail = snapshot.tailLines
    ? processLines(snapshot.tailLines, tabId, fallbackFg, accents)
    : snapshot.tailLines
  return { ...snapshot, lines: nextLines, tailLines: nextTail }
}

#!/usr/bin/env bun
/* eslint-disable no-console -- a generator: console IS the UI */
//
// Generates `docs/reference/plugin-api.md` from the sources of
// `@brimveyn/aimux-plugin`.
//
// Why generate rather than write: the audience for this page is as often an
// agent as a human, and an agent that reads a stale API invents one. A page
// derived from the declarations cannot drift from them — `bun test` fails if
// the committed page and the sources disagree.
//
// Deliberately not a doc generator. It extracts each exported declaration
// verbatim, with the comment that was already written above it, because the
// declaration *is* the documentation: `register: (widget: PluginBarWidget) =>
// Disposer` says more, and more reliably, than any prose rendering of it.
//
// Run via `bun run docs:plugin-api`.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const SRC = join(ROOT, 'packages/aimux-plugin/src')
const OUT = join(ROOT, 'docs/reference/plugin-api.md')
/** The skill ships the same page; an agent reading it must not read an old one. */
const SKILL_COPY = join(ROOT, 'skills/aimux-plugin-author/references/api.md')

interface Section {
  file: string
  title: string
  blurb: string
}

/** Order is teaching order, not alphabetical: manifest, context, then surfaces. */
const SECTIONS: Section[] = [
  {
    blurb: 'What aimux reads before running a line of plugin code.',
    file: 'manifest.ts',
    title: 'The manifest',
  },
  {
    blurb: 'The context every half receives, and what it may do with it.',
    file: 'types.ts',
    title: 'The plugin context',
  },
  {
    blurb: 'How a definition is declared. One export, one shape.',
    file: 'define-plugin.ts',
    title: 'Defining a plugin',
  },
  {
    blurb: '`ctx.ui`, `ctx.actions`, `ctx.store` — the half that draws.',
    file: 'ui.ts',
    title: 'The UI half',
  },
  {
    blurb: 'The half that runs whether or not anyone is looking.',
    file: 'daemon-api.ts',
    title: 'The daemon half',
  },
  {
    blurb: 'Five dispatch modes. The one you pick is a statement about failure.',
    file: 'event-bus.ts',
    title: 'Events',
  },
  {
    blurb: 'Why an unload is total, and how to make one that is not impossible.',
    file: 'effects.ts',
    title: 'Effects',
  },
  {
    blurb: 'The context with nothing behind it. A plugin test needs no aimux.',
    file: 'test-context.ts',
    title: 'Testing',
  },
]

/** A declaration keeps the comment written above it; that is the documentation. */
interface Declaration {
  doc: string[]
  code: string[]
}

function depthDelta(line: string): number {
  // Good enough: these files have no braces inside string literals, and a
  // generator that needed a parser to read its own package would be a sign the
  // package had become too clever.
  let delta = 0
  for (const char of line) {
    if (char === '{' || char === '(' || char === '[') delta += 1
    if (char === '}' || char === ')' || char === ']') delta -= 1
  }
  return delta
}

function isDeclarationStart(line: string): boolean {
  return /^export (?:declare )?(?:abstract )?(?:interface|type|class|function|const) /.test(line)
}

/** A continuation of a one-line-balanced declaration: a wrapped union or type. */
function continues(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed === '') return false
  return /^[|&?:]/.test(trimmed) || line.startsWith(' ')
}

/**
 * A class in the reference is its public surface, not its implementation.
 * `PluginEventBus` is 150 lines of dispatch that nobody calling it needs to
 * read, and pasting them would bury the six method signatures that matter.
 */
function summarizeClass(code: readonly string[]): string[] {
  const out: string[] = [code[0] ?? '']
  // Comments and blank lines belong to the member below them, so they are held
  // until that member is either emitted or dropped.
  let pending: string[] = []
  let depth = depthDelta(code[0] ?? '')
  let skipTo: number | null = null

  for (let i = 1; i < code.length; i++) {
    const line = code[i] ?? ''
    const before = depth
    depth += depthDelta(line)

    if (skipTo !== null) {
      if (depth <= skipTo) skipTo = null
      continue
    }
    if (before === 0) {
      out.push(line)
      continue
    }
    if (before !== 1) continue

    const trimmed = line.trim()
    if (trimmed === '' || /^(?:\/\*|\*|\/\/)/.test(trimmed)) {
      pending.push(line)
      continue
    }
    // Private state and private methods are not API. The `#` form too.
    if (trimmed.startsWith('private') || trimmed.startsWith('#')) {
      pending = []
      if (depth > before) skipTo = before
      continue
    }
    out.push(...pending)
    pending = []
    if (depth > before) {
      out.push(`${line.replace(/\{\s*$/, '{')} … }`)
      skipTo = before
      continue
    }
    out.push(line)
  }

  // A blank line right after the opening brace reads as a missing member.
  if ((out[1] ?? '').trim() === '') out.splice(1, 1)
  return out
}

function extract(source: string): Declaration[] {
  const lines = source.split('\n')
  const declarations: Declaration[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (!isDeclarationStart(line)) continue

    // Walk back over the comment block immediately above, if any.
    const doc: string[] = []
    let j = i - 1
    if ((lines[j] ?? '').trim().endsWith('*/')) {
      while (j >= 0 && !(lines[j] ?? '').trim().startsWith('/*')) j--
      for (let k = j; k < i; k++) doc.push(lines[k] ?? '')
    } else {
      while (j >= 0 && (lines[j] ?? '').trim().startsWith('//')) j--
      for (let k = j + 1; k < i; k++) doc.push(lines[k] ?? '')
    }

    const code: string[] = [line]
    let depth = depthDelta(line)
    let cursor = i + 1
    while (cursor < lines.length) {
      const next = lines[cursor] ?? ''
      if (depth <= 0 && !continues(next)) break
      code.push(next)
      depth += depthDelta(next)
      cursor++
    }
    while (code.length > 0 && (code.at(-1) ?? '').trim() === '') code.pop()

    declarations.push({ code: line.startsWith('export class') ? summarizeClass(code) : code, doc })
    i = cursor - 1
  }

  return declarations
}

/** The comment at the very top of a file, before any import. */
function fileHeader(source: string): string[] {
  const lines = source.split('\n')
  const header: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('//')) {
      header.push(trimmed.replace(/^\/\/ ?/, ''))
      continue
    }
    if (trimmed === '' && header.length === 0) continue
    break
  }
  return header
}

function render(): string {
  const out: string[] = [
    '# Plugin API reference',
    '',
    '<!-- Generated by `bun run docs:plugin-api`. Do not edit by hand. -->',
    '',
    'Every export of `@brimveyn/aimux-plugin`, as declared, with the comment',
    'written above it. The declaration is the documentation: a signature says',
    'more, and more reliably, than prose about a signature.',
    '',
    'For how the pieces fit together, read `docs/developer/plugins.md`. For a',
    'plugin that already works, run `aimux plugin new <id>`.',
    '',
  ]

  for (const section of SECTIONS) {
    const source = readFileSync(join(SRC, section.file), 'utf8')
    out.push(`## ${section.title}`, '', section.blurb, '')

    const header = fileHeader(source)
    if (header.length > 0) out.push(...header.map((line) => `> ${line}`.trimEnd()), '')

    for (const declaration of extract(source)) {
      out.push('```ts')
      out.push(...declaration.doc, ...declaration.code)
      out.push('```', '')
    }
  }

  return `${out
    .join('\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`
}

/** Exported so a test can assert the committed page matches the sources. */
export function renderPluginApiDoc(): string {
  return render()
}

if (import.meta.main === true) {
  const content = render()
  writeFileSync(OUT, content, 'utf8')
  writeFileSync(SKILL_COPY, content, 'utf8')
  console.log(`wrote ${OUT}`)
  console.log(`wrote ${SKILL_COPY}`)
}

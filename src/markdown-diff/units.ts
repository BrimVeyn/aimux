// A Markdown document cut into the units a diff compares and a terminal draws:
// one heading, one paragraph, one list item, one code block, one table. Lists
// are flattened to items with a depth, so an edit deep inside a nested list is a
// change to one item rather than to the whole list.

import { lexer, type Token, type Tokens } from 'marked'

export interface SpanStyle {
  code?: true
  del?: true
  em?: true
  link?: true
  strong?: true
}

export interface Span {
  style: SpanStyle
  text: string
}

export type TableAlign = 'center' | 'left' | 'right' | null

interface UnitBase {
  /** Nesting under list items, in levels. */
  indent: number
  /** Inside a blockquote. */
  quote: boolean
}

export type Unit = UnitBase &
  (
    | { kind: 'code'; lang: string; lines: string[] }
    | { kind: 'heading'; depth: number; spans: Span[] }
    | { kind: 'html'; text: string }
    | { kind: 'image'; alt: string; src: string }
    | { kind: 'item'; marker: string; spans: Span[] }
    | { kind: 'paragraph'; spans: Span[] }
    | { kind: 'rule' }
    | { align: TableAlign[]; header: Span[][]; kind: 'table'; rows: Span[][][] }
  )

function inlineSpans(tokens: readonly Token[] | undefined, style: SpanStyle, out: Span[]): void {
  for (const token of tokens ?? []) {
    switch (token.type) {
      case 'strong':
      case 'em':
      case 'del':
        inlineSpans(token.tokens, { ...style, [token.type]: true }, out)
        break
      case 'link':
        inlineSpans(token.tokens, { ...style, link: true }, out)
        break
      case 'codespan':
        out.push({ style: { ...style, code: true }, text: unescape(token.text) })
        break
      case 'image':
        out.push({
          style: { ...style, link: true },
          text: `[${token.text === '' ? 'image' : token.text}]`,
        })
        break
      case 'br':
        out.push({ style, text: '\n' })
        break
      case 'text':
        if ('tokens' in token && Array.isArray(token.tokens) && token.tokens.length > 0) {
          inlineSpans(token.tokens, style, out)
        } else {
          out.push({ style, text: unescape(token.text) })
        }
        break
      default:
        if ('text' in token && typeof token.text === 'string') {
          out.push({ style, text: unescape(token.text) })
        } else if ('raw' in token) {
          out.push({ style, text: token.raw })
        }
    }
  }
}

// marked leaves HTML entities escaped in text tokens.
function unescape(text: string): string {
  return text
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
}

function spansOf(tokens: readonly Token[] | undefined): Span[] {
  const out: Span[] = []
  inlineSpans(tokens, {}, out)
  return out
}

/** A paragraph that is nothing but images (and the space between them). */
function onlyImages(tokens: readonly Token[]): Tokens.Image[] | null {
  const images: Tokens.Image[] = []
  for (const token of tokens) {
    if (token.type === 'image') images.push(token as Tokens.Image)
    else if (token.type === 'text' && token.raw.trim() === '') continue
    else if (token.type === 'br') continue
    else return null
  }
  return images.length > 0 ? images : null
}

interface Context {
  indent: number
  quote: boolean
}

function itemMarker(list: Tokens.List, item: Tokens.ListItem, index: number): string {
  if (item.task) return item.checked === true ? '☑' : '☐'
  if (list.ordered) {
    const start = typeof list.start === 'number' ? list.start : 1
    return `${start + index}.`
  }
  return '•'
}

function walkBlocks(tokens: readonly Token[], ctx: Context, out: Unit[]): void {
  for (const token of tokens) {
    const base = { indent: ctx.indent, quote: ctx.quote }
    switch (token.type) {
      case 'heading':
        out.push({ ...base, depth: token.depth, kind: 'heading', spans: spansOf(token.tokens) })
        break
      case 'paragraph': {
        const images = onlyImages(token.tokens ?? [])
        if (images) {
          for (const img of images)
            out.push({ ...base, alt: img.text, kind: 'image', src: img.href })
        } else {
          out.push({ ...base, kind: 'paragraph', spans: spansOf(token.tokens) })
        }
        break
      }
      case 'text':
        // A loose run of inline text at block level (inside list items).
        out.push({
          ...base,
          kind: 'paragraph',
          spans: spansOf('tokens' in token ? token.tokens : undefined),
        })
        break
      case 'list': {
        const list = token as Tokens.List
        for (const [index, item] of list.items.entries()) walkItem(list, item, index, ctx, out)
        break
      }
      case 'blockquote':
        walkBlocks(token.tokens ?? [], { ...ctx, quote: true }, out)
        break
      case 'code':
        out.push({
          ...base,
          kind: 'code',
          lang: (token.lang ?? '').split(/\s/)[0] ?? '',
          lines: token.text.split('\n'),
        })
        break
      case 'table': {
        const table = token as Tokens.Table
        out.push({
          ...base,
          align: table.align,
          header: table.header.map((cell) => spansOf(cell.tokens)),
          kind: 'table',
          rows: table.rows.map((row) => row.map((cell) => spansOf(cell.tokens))),
        })
        break
      }
      case 'hr':
        out.push({ ...base, kind: 'rule' })
        break
      case 'html':
        if (token.raw.trim() !== '') out.push({ ...base, kind: 'html', text: token.raw.trimEnd() })
        break
      default:
        // space, def: nothing to draw.
        break
    }
  }
}

function walkItem(
  list: Tokens.List,
  item: Tokens.ListItem,
  index: number,
  ctx: Context,
  out: Unit[]
): void {
  const marker = itemMarker(list, item, index)
  const children = item.tokens.filter((t) => t.type !== 'checkbox')
  // The item's own line is its first inline block; anything after it (nested
  // lists, further paragraphs, code) is drawn one level in.
  const first = children[0]
  let rest = children
  let spans: Span[] = []
  if (first && (first.type === 'text' || first.type === 'paragraph')) {
    spans = spansOf('tokens' in first ? first.tokens : undefined)
    rest = children.slice(1)
  }
  out.push({ indent: ctx.indent, kind: 'item', marker, quote: ctx.quote, spans })
  walkBlocks(rest, { ...ctx, indent: ctx.indent + 1 }, out)
}

export function parseUnits(markdown: string): Unit[] {
  const out: Unit[] = []
  walkBlocks(lexer(markdown, { gfm: true }), { indent: 0, quote: false }, out)
  return out
}

export function plainText(spans: readonly Span[]): string {
  return spans.map((s) => s.text).join('')
}

/** What two units must share to be the same unit. Styling is part of it. */
export function unitKey(unit: Unit): string {
  const where = `${unit.indent}${unit.quote ? '>' : ''}`
  switch (unit.kind) {
    case 'code':
      return `code${where}:${unit.lang}:${unit.lines.join('\n')}`
    case 'heading':
      return `h${unit.depth}${where}:${JSON.stringify(unit.spans)}`
    case 'html':
      return `html${where}:${unit.text}`
    case 'image':
      return `img${where}:${unit.src}:${unit.alt}`
    case 'item':
      return `item${where}:${unit.marker}:${JSON.stringify(unit.spans)}`
    case 'paragraph':
      return `p${where}:${JSON.stringify(unit.spans)}`
    case 'rule':
      return `hr${where}`
    case 'table':
      return `table${where}:${JSON.stringify([unit.align, unit.header, unit.rows])}`
  }
}

/** The words a unit says, for judging how alike two units are. */
export function unitWords(unit: Unit): string[] {
  let text: string
  switch (unit.kind) {
    case 'code':
      text = unit.lines.join(' ')
      break
    case 'heading':
    case 'item':
    case 'paragraph':
      text = plainText(unit.spans)
      break
    case 'html':
      text = unit.text
      break
    case 'image':
      text = `${unit.alt} ${unit.src}`
      break
    case 'rule':
      text = ''
      break
    case 'table':
      text = [unit.header, ...unit.rows]
        .flat()
        .map((cell) => plainText(cell))
        .join(' ')
      break
  }
  return text.toLowerCase().split(/\W+/u).filter(Boolean)
}

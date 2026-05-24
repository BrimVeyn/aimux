import type { SnippetRecord } from '../state/types'

/**
 * Snippet/macro content expander.
 *
 * Supports:
 *  - Custom (per-snippet) variables resolved upstream and passed via `customVars`.
 *    These shadow built-ins on name collision.
 *  - `{{date}}`, `{{date:FORMAT}}` with tokens YYYY MM DD HH mm ss
 *  - `{{cwd}}` (resolved from context)
 *  - `{{branch}}` (resolved from context; empty string when null)
 *  - `{{clipboard}}` (async; only available via `expandSnippet`)
 *  - `$|` cursor placeholder (first occurrence wins; subsequent are stripped)
 *  - Unknown `{{...}}` tokens are left literal.
 */

export interface ExpansionContext {
  cwd: string
  branch: string | null
  now: Date
  customVars: ReadonlyMap<string, string>
  clipboard: () => Promise<string>
}

export type SyncExpansionContext = Omit<ExpansionContext, 'clipboard'>

export interface ExpansionResult {
  text: string
  cursorOffset: number
}

const VAR_RE = /\{\{([^{}]+)\}\}/g

const TWO = (n: number): string => String(n).padStart(2, '0')

function formatDate(date: Date, format?: string): string {
  if (!(format != null && format !== '')) {
    return `${date.getFullYear()}-${TWO(date.getMonth() + 1)}-${TWO(date.getDate())}`
  }
  return format
    .replaceAll('YYYY', String(date.getFullYear()))
    .replaceAll('MM', TWO(date.getMonth() + 1))
    .replaceAll('DD', TWO(date.getDate()))
    .replaceAll('HH', TWO(date.getHours()))
    .replaceAll('mm', TWO(date.getMinutes()))
    .replaceAll('ss', TWO(date.getSeconds()))
}

function resolveSyncVariable(name: string, ctx: SyncExpansionContext): string | null {
  const custom = ctx.customVars.get(name)
  if (custom !== undefined) return custom
  if (name === 'date') return formatDate(ctx.now)
  if (name.startsWith('date:')) return formatDate(ctx.now, name.slice('date:'.length))
  if (name === 'cwd') return ctx.cwd
  if (name === 'branch') return ctx.branch ?? ''
  return null
}

/**
 * Replace `$|` with a cursor offset.
 * First occurrence becomes the offset; additional ones are stripped.
 * If none present, cursor is placed at the end of the text.
 */
function extractCursor(text: string): ExpansionResult {
  const firstIndex = text.indexOf('$|')
  if (firstIndex === -1) {
    return { cursorOffset: text.length, text }
  }
  const before = text.slice(0, firstIndex)
  const after = text
    .slice(firstIndex + 2)
    .split('$|')
    .join('')
  return { cursorOffset: before.length, text: before + after }
}

export function contentNeedsClipboard(content: string): boolean {
  return /\{\{\s*clipboard\s*\}\}/.test(content)
}

export function requiresAsyncExpansion(snippet: SnippetRecord): boolean {
  const hasVars = snippet.vars !== undefined && Object.keys(snippet.vars).length > 0
  return hasVars || contentNeedsClipboard(snippet.content)
}

export function expandSnippetSync(content: string, ctx: SyncExpansionContext): ExpansionResult {
  const replaced = content.replace(VAR_RE, (match, rawName: string) => {
    const name = rawName.trim()
    if (name === 'clipboard') return match
    const resolved = resolveSyncVariable(name, ctx)
    return resolved ?? match
  })
  return extractCursor(replaced)
}

export async function expandSnippet(
  content: string,
  ctx: ExpansionContext
): Promise<ExpansionResult> {
  let clipboardValue: string | null = null
  const needsClipboard = contentNeedsClipboard(content) && !ctx.customVars.has('clipboard')
  if (needsClipboard) {
    clipboardValue = await ctx.clipboard()
  }
  const replaced = content.replace(VAR_RE, (match, rawName: string) => {
    const name = rawName.trim()
    if (name === 'clipboard' && clipboardValue !== null) return clipboardValue
    const resolved = resolveSyncVariable(name, ctx)
    return resolved ?? match
  })
  return extractCursor(replaced)
}

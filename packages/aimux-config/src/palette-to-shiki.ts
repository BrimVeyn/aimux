// Build a Shiki ThemeRegistrationRaw from the opencode-resolved token map.
// The same ResolvedTokens map powers UI chrome and the diff highlighter so
// light/dark/overrides stay coherent automatically.

import type { ThemeRegistrationRaw } from 'shiki'

import type { ResolvedToken, ResolvedTokens } from './resolved-tokens'
import type { ThemeMode } from './types'

export interface PaletteToShikiOptions {
  name: string
  mode: ThemeMode
  tokens: ResolvedTokens
}

// Resolve `var(--<token-name>)` indirections produced by opencode's compact
// syntax map. Falls back to the raw value when the reference is unknown or
// already a hex string.
function resolveValue(value: string, tokens: ResolvedTokens): string {
  const m = /^var\(--(.+)\)$/.exec(value)
  if (!m) return value
  const key = m[1] as ResolvedToken
  const v = tokens[key]
  if (typeof v === 'string') {
    // Guard against pathological `var(--a) → var(--b) → ...` chains.
    return v.startsWith('var(--') ? value : v
  }
  return value
}

export function paletteToShikiTheme(opts: PaletteToShikiOptions): ThemeRegistrationRaw {
  const { mode, name, tokens } = opts
  const r = (key: ResolvedToken): string => resolveValue(tokens[key], tokens)

  const bg = tokens['background-base']
  const fg = r('text-base')
  const comment = r('syntax-comment')
  const string = r('syntax-string')
  const regexp = r('syntax-regexp')
  const constant = r('syntax-constant')
  const keyword = r('syntax-keyword')
  const operator = r('syntax-operator')
  const fn = r('syntax-success')
  const type = r('syntax-type')
  const variable = r('syntax-variable')
  const property = r('syntax-property')
  const punctuation = r('syntax-punctuation')
  const tag = r('syntax-critical')
  const attribute = r('syntax-warning')
  const heading = r('markdown-heading')
  const bold = r('markdown-strong')
  const emph = r('markdown-emph')
  const code = r('markdown-code')
  const list = r('markdown-list-item')
  const blockQuote = r('markdown-block-quote')
  const diffAdd = r('syntax-diff-add')
  const diffDelete = r('syntax-diff-delete')
  const diffRange = r('markdown-link')

  return {
    bg,
    colors: {
      'editor.background': bg,
      'editor.foreground': fg,
    },
    fg,
    name,
    settings: [
      { settings: { background: bg, foreground: fg } },
      {
        scope: ['comment', 'punctuation.definition.comment'],
        settings: { fontStyle: 'italic', foreground: comment },
      },
      { scope: ['comment.documentation'], settings: { fontStyle: 'italic', foreground: comment } },
      {
        scope: ['string', 'string.quoted', 'string.template'],
        settings: { foreground: string },
      },
      {
        scope: ['string.regexp', 'string.escape', 'constant.character.escape'],
        settings: { foreground: regexp },
      },
      {
        scope: [
          'constant.numeric',
          'constant.language',
          'constant.language.boolean',
          'constant.character',
          'constant.other',
          'support.constant',
        ],
        settings: { foreground: constant },
      },
      {
        scope: ['keyword', 'keyword.control', 'keyword.operator.new', 'keyword.other'],
        settings: { fontStyle: 'bold', foreground: keyword },
      },
      {
        scope: ['storage', 'storage.type', 'storage.modifier'],
        settings: { fontStyle: 'bold', foreground: keyword },
      },
      {
        scope: ['keyword.operator', 'punctuation', 'meta.brace', 'punctuation.separator'],
        settings: { foreground: operator },
      },
      {
        scope: [
          'entity.name.function',
          'support.function',
          'meta.function-call',
          'entity.name.function.member',
        ],
        settings: { foreground: fn },
      },
      {
        scope: [
          'entity.name.type',
          'support.type',
          'support.class',
          'entity.name.class',
          'entity.name.interface',
          'entity.name.namespace',
          'entity.name.type.enum',
          'entity.name.type.alias',
          'entity.name.tag.jsx',
          'support.class.component',
        ],
        settings: { fontStyle: 'italic', foreground: type },
      },
      { scope: ['variable', 'meta.variable'], settings: { foreground: variable } },
      {
        scope: ['variable.parameter', 'meta.function.parameters'],
        settings: { fontStyle: 'italic', foreground: variable },
      },
      {
        scope: ['variable.other.property', 'variable.other.member', 'meta.object-literal.key'],
        settings: { foreground: property },
      },
      {
        scope: ['variable.language', 'variable.language.this'],
        settings: { fontStyle: 'italic', foreground: constant },
      },
      { scope: ['entity.name.tag', 'meta.tag'], settings: { foreground: tag } },
      {
        scope: ['entity.other.attribute-name'],
        settings: { fontStyle: 'italic', foreground: attribute },
      },
      // punctuation-specific override kept so scopes like `punctuation.section.embedded`
      // inherit a colour distinct from keyword.operator.
      { scope: ['punctuation.section'], settings: { foreground: punctuation } },
      // Markdown
      { scope: ['markup.heading'], settings: { fontStyle: 'bold', foreground: heading } },
      { scope: ['markup.bold'], settings: { fontStyle: 'bold', foreground: bold } },
      { scope: ['markup.italic'], settings: { fontStyle: 'italic', foreground: emph } },
      {
        scope: ['markup.underline.link', 'markup.inline.raw', 'markup.raw'],
        settings: { foreground: code },
      },
      { scope: ['markup.list'], settings: { foreground: list } },
      { scope: ['markup.quote'], settings: { fontStyle: 'italic', foreground: blockQuote } },
      // Diff
      {
        scope: ['markup.inserted', 'meta.diff.header.to-file'],
        settings: { foreground: diffAdd },
      },
      {
        scope: ['markup.deleted', 'meta.diff.header.from-file'],
        settings: { foreground: diffDelete },
      },
      { scope: ['markup.changed'], settings: { foreground: attribute } },
      { scope: ['meta.diff.range'], settings: { foreground: diffRange } },
    ],
    type: mode,
  }
}

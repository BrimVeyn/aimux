// Build a Shiki ThemeRegistrationRaw from a resolved TUI theme.

import type { ThemeRegistrationRaw } from 'shiki'

import type { ResolvedTuiTheme, ThemeMode } from './types'

export interface TuiShikiOptions {
  name: string
  mode: ThemeMode
  theme: ResolvedTuiTheme
}

export function tuiThemeToShiki(opts: TuiShikiOptions): ThemeRegistrationRaw {
  const { mode, name, theme: t } = opts
  const bg = t.background
  const fg = t.text

  return {
    bg,
    colors: { 'editor.background': bg, 'editor.foreground': fg },
    fg,
    name,
    settings: [
      { settings: { background: bg, foreground: fg } },
      {
        scope: ['comment', 'punctuation.definition.comment', 'comment.documentation'],
        settings: { fontStyle: 'italic', foreground: t.syntaxComment },
      },
      {
        scope: ['string', 'string.quoted', 'string.template'],
        settings: { foreground: t.syntaxString },
      },
      {
        scope: ['string.regexp', 'string.escape', 'constant.character.escape'],
        settings: { foreground: t.syntaxString },
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
        settings: { foreground: t.syntaxNumber },
      },
      {
        scope: [
          'keyword',
          'keyword.control',
          'keyword.operator.new',
          'keyword.other',
          'storage',
          'storage.type',
          'storage.modifier',
        ],
        settings: { fontStyle: 'bold', foreground: t.syntaxKeyword },
      },
      {
        scope: ['keyword.operator', 'meta.brace', 'punctuation.separator'],
        settings: { foreground: t.syntaxOperator },
      },
      {
        scope: ['punctuation', 'punctuation.section'],
        settings: { foreground: t.syntaxPunctuation },
      },
      {
        scope: [
          'entity.name.function',
          'support.function',
          'meta.function-call',
          'entity.name.function.member',
        ],
        settings: { foreground: t.syntaxFunction },
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
        settings: { fontStyle: 'italic', foreground: t.syntaxType },
      },
      {
        scope: ['variable', 'meta.variable'],
        settings: { foreground: t.syntaxVariable },
      },
      {
        scope: ['variable.parameter', 'meta.function.parameters'],
        settings: { fontStyle: 'italic', foreground: t.syntaxVariable },
      },
      {
        scope: ['variable.other.property', 'variable.other.member', 'meta.object-literal.key'],
        settings: { foreground: t.syntaxVariable },
      },
      {
        scope: ['variable.language', 'variable.language.this'],
        settings: { fontStyle: 'italic', foreground: t.syntaxNumber },
      },
      { scope: ['entity.name.tag', 'meta.tag'], settings: { foreground: t.error } },
      {
        scope: ['entity.other.attribute-name'],
        settings: { fontStyle: 'italic', foreground: t.warning },
      },
      // Markdown
      {
        scope: ['markup.heading'],
        settings: { fontStyle: 'bold', foreground: t.markdownHeading },
      },
      {
        scope: ['markup.bold'],
        settings: { fontStyle: 'bold', foreground: t.markdownStrong },
      },
      {
        scope: ['markup.italic'],
        settings: { fontStyle: 'italic', foreground: t.markdownEmph },
      },
      {
        scope: ['markup.underline.link', 'markup.inline.raw', 'markup.raw'],
        settings: { foreground: t.markdownCode },
      },
      { scope: ['markup.list'], settings: { foreground: t.markdownListItem } },
      {
        scope: ['markup.quote'],
        settings: { fontStyle: 'italic', foreground: t.markdownBlockQuote },
      },
      // Diff
      {
        scope: ['markup.inserted', 'meta.diff.header.to-file'],
        settings: { foreground: t.diffAdded },
      },
      {
        scope: ['markup.deleted', 'meta.diff.header.from-file'],
        settings: { foreground: t.diffRemoved },
      },
      { scope: ['markup.changed'], settings: { foreground: t.warning } },
      { scope: ['meta.diff.range'], settings: { foreground: t.diffHunkHeader } },
    ],
    type: mode,
  }
}

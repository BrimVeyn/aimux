// Build a Shiki ThemeRegistrationRaw from an AimuxPalette. The same palette
// powers the UI chrome and the diff syntax highlighter — there's no static
// theme JSON, so light/dark/overrides stay coherent automatically.

import type { ThemeRegistrationRaw } from 'shiki'

import type { AimuxPalette, ThemeMode } from './types'

import { accent as accentOf, muted } from './palette-utils'

export interface PaletteToShikiOptions {
  name: string
  mode: ThemeMode
  palette: AimuxPalette
}

export function paletteToShikiTheme(opts: PaletteToShikiOptions): ThemeRegistrationRaw {
  const { mode, name, palette: p } = opts
  const m = muted(p)
  const a = accentOf(p)

  return {
    bg: p.neutral,
    colors: {
      'editor.background': p.neutral,
      'editor.foreground': p.ink,
    },
    fg: p.ink,
    name,
    settings: [
      { settings: { background: p.neutral, foreground: p.ink } },
      {
        scope: ['comment', 'punctuation.definition.comment'],
        settings: { fontStyle: 'italic', foreground: m },
      },
      { scope: ['comment.documentation'], settings: { fontStyle: 'italic', foreground: m } },
      {
        scope: ['string', 'string.quoted', 'string.template'],
        settings: { foreground: p.warning },
      },
      {
        scope: ['string.regexp', 'string.escape', 'constant.character.escape'],
        settings: { foreground: a },
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
        settings: { foreground: p.error },
      },
      {
        scope: ['keyword', 'keyword.control', 'keyword.operator.new', 'keyword.other'],
        settings: { fontStyle: 'bold', foreground: a },
      },
      {
        scope: ['storage', 'storage.type', 'storage.modifier'],
        settings: { fontStyle: 'bold', foreground: a },
      },
      {
        scope: ['keyword.operator', 'punctuation', 'meta.brace', 'punctuation.separator'],
        settings: { foreground: m },
      },
      {
        scope: [
          'entity.name.function',
          'support.function',
          'meta.function-call',
          'entity.name.function.member',
        ],
        settings: { foreground: p.success },
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
        settings: { fontStyle: 'italic', foreground: p.primary },
      },
      { scope: ['variable', 'meta.variable'], settings: { foreground: p.ink } },
      {
        scope: ['variable.parameter', 'meta.function.parameters'],
        settings: { fontStyle: 'italic', foreground: p.ink },
      },
      {
        scope: ['variable.other.property', 'variable.other.member', 'meta.object-literal.key'],
        settings: { foreground: p.primary },
      },
      {
        scope: ['variable.language', 'variable.language.this'],
        settings: { fontStyle: 'italic', foreground: p.error },
      },
      { scope: ['entity.name.tag', 'meta.tag'], settings: { foreground: p.error } },
      {
        scope: ['entity.other.attribute-name'],
        settings: { fontStyle: 'italic', foreground: p.warning },
      },
      // Markdown
      { scope: ['markup.heading'], settings: { fontStyle: 'bold', foreground: p.primary } },
      { scope: ['markup.bold'], settings: { fontStyle: 'bold', foreground: p.ink } },
      { scope: ['markup.italic'], settings: { fontStyle: 'italic', foreground: p.ink } },
      {
        scope: ['markup.underline.link', 'markup.inline.raw', 'markup.raw'],
        settings: { foreground: p.success },
      },
      { scope: ['markup.list'], settings: { foreground: a } },
      { scope: ['markup.quote'], settings: { fontStyle: 'italic', foreground: m } },
      // Diff
      {
        scope: ['markup.inserted', 'meta.diff.header.to-file'],
        settings: { foreground: p.success },
      },
      {
        scope: ['markup.deleted', 'meta.diff.header.from-file'],
        settings: { foreground: p.error },
      },
      { scope: ['markup.changed'], settings: { foreground: p.warning } },
      { scope: ['meta.diff.range'], settings: { foreground: a } },
    ],
    type: mode,
  }
}

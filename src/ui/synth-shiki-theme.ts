import type { ThemeColors } from './themes'

interface SynthSetting {
  scope?: string | string[]
  settings: {
    fontStyle?: string
    foreground?: string
  }
}

export interface SynthShikiTheme {
  colors: Record<string, string>
  name: string
  settings: SynthSetting[]
  type: 'dark' | 'light'
}

export function synthShikiTheme(
  id: string,
  colors: ThemeColors,
  type: 'dark' | 'light' = 'dark'
): SynthShikiTheme {
  return {
    colors: {
      'editor.background': colors.background,
      'editor.foreground': colors.text,
    },
    name: id,
    settings: [
      { settings: { foreground: colors.text } },
      {
        scope: ['comment', 'punctuation.definition.comment'],
        settings: { fontStyle: 'italic', foreground: colors.textMuted },
      },
      { scope: ['string', 'string.quoted'], settings: { foreground: colors.warning } },
      {
        scope: ['string.regexp', 'string.escape', 'constant.character.escape'],
        settings: { foreground: colors.accentAlt },
      },
      {
        scope: ['constant.numeric', 'constant.language', 'constant'],
        settings: { foreground: colors.danger },
      },
      {
        scope: ['keyword', 'storage', 'storage.type', 'storage.modifier'],
        settings: { fontStyle: 'bold', foreground: colors.accentAlt },
      },
      {
        scope: ['keyword.operator', 'punctuation', 'meta.brace'],
        settings: { foreground: colors.textMuted },
      },
      {
        scope: ['entity.name.function', 'support.function', 'meta.function-call'],
        settings: { foreground: colors.success },
      },
      {
        scope: ['entity.name.type', 'support.type', 'support.class', 'entity.name.class'],
        settings: { fontStyle: 'italic', foreground: colors.accent },
      },
      { scope: ['variable'], settings: { foreground: colors.text } },
      {
        scope: ['variable.parameter', 'meta.function.parameters'],
        settings: { fontStyle: 'italic', foreground: colors.text },
      },
      {
        scope: ['variable.other.property', 'variable.other.member', 'meta.object-literal.key'],
        settings: { foreground: colors.accent },
      },
      { scope: ['entity.name.tag', 'meta.tag'], settings: { foreground: colors.danger } },
      {
        scope: ['entity.other.attribute-name'],
        settings: { fontStyle: 'italic', foreground: colors.warning },
      },
    ],
    type,
  }
}

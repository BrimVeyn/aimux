import { getTreeSitterClient, SyntaxStyle, type ThemeTokenStyle } from '@opentui/core'

import { onThemeChange, theme } from './theme'

let cachedStyle: SyntaxStyle | null = null
let clientInitPromise: Promise<void> | null = null

onThemeChange(() => {
  cachedStyle = null
})

function buildTokens(): ThemeTokenStyle[] {
  return [
    {
      scope: ['comment', 'spell'],
      style: { dim: true, foreground: theme.textMuted, italic: true },
    },
    { scope: ['comment.documentation'], style: { foreground: theme.textMuted, italic: true } },

    {
      scope: ['string', 'character', 'character.special', 'string.special'],
      style: { foreground: theme.warning },
    },
    {
      scope: ['string.escape', 'string.regexp', 'string.special.url'],
      style: { foreground: theme.accentAlt },
    },

    {
      scope: ['number', 'boolean', 'constant.builtin', 'constant.numeric'],
      style: { foreground: theme.danger },
    },
    { scope: ['constant', 'constant.character'], style: { foreground: theme.danger } },

    { scope: ['keyword'], style: { bold: true, foreground: theme.accentAlt } },
    {
      scope: [
        'keyword.conditional',
        'keyword.exception',
        'keyword.import',
        'keyword.modifier',
        'keyword.repeat',
      ],
      style: { bold: true, foreground: theme.accentAlt },
    },
    {
      scope: [
        'keyword.coroutine',
        'keyword.directive',
        'keyword.function',
        'keyword.return',
        'keyword.type',
      ],
      style: { bold: true, foreground: theme.accentAlt, italic: true },
    },
    { scope: ['keyword.operator', 'operator'], style: { foreground: theme.accent } },

    {
      scope: ['function', 'function.call', 'function.method', 'function.method.call'],
      style: { foreground: theme.success },
    },
    { scope: ['function.builtin'], style: { foreground: theme.success, italic: true } },
    { scope: ['constructor'], style: { bold: true, foreground: theme.success } },

    { scope: ['type', 'type.definition'], style: { foreground: theme.accent, italic: true } },
    { scope: ['type.builtin'], style: { bold: true, foreground: theme.accent } },

    { scope: ['variable'], style: { foreground: theme.text } },
    { scope: ['variable.builtin'], style: { foreground: theme.danger, italic: true } },
    { scope: ['variable.parameter', 'parameter'], style: { foreground: theme.text, italic: true } },
    { scope: ['variable.member', 'property', 'field'], style: { foreground: theme.accent } },

    { scope: ['attribute'], style: { foreground: theme.warning, italic: true } },
    { scope: ['tag'], style: { foreground: theme.danger } },
    { scope: ['tag.attribute'], style: { foreground: theme.warning, italic: true } },

    { scope: ['label'], style: { foreground: theme.warning } },
    { scope: ['module', 'namespace'], style: { foreground: theme.accentAlt, italic: true } },
    { scope: ['module.builtin'], style: { bold: true, foreground: theme.accentAlt, italic: true } },

    {
      scope: ['punctuation.bracket', 'punctuation.delimiter'],
      style: { foreground: theme.textMuted },
    },
    { scope: ['punctuation.special'], style: { foreground: theme.warning } },
  ]
}

export function getSyntaxStyle(): SyntaxStyle {
  if (!cachedStyle) {
    cachedStyle = SyntaxStyle.fromTheme(buildTokens())
  }
  return cachedStyle
}

export function getSyntaxClient() {
  const client = getTreeSitterClient()
  if (!clientInitPromise) {
    clientInitPromise = client.initialize().catch(() => {})
  }
  return client
}

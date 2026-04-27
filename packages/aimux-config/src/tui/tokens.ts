// 44-token namespace ported 1:1 from opencode TUI
// (opencode/packages/plugin/src/tui.ts:191-245).

export type TuiColorToken =
  | 'primary'
  | 'secondary'
  | 'accent'
  | 'error'
  | 'warning'
  | 'success'
  | 'info'
  | 'text'
  | 'textMuted'
  | 'selectedListItemText'
  | 'background'
  | 'backgroundPanel'
  | 'backgroundElement'
  | 'backgroundMenu'
  | 'border'
  | 'borderActive'
  | 'borderSubtle'
  | 'diffAdded'
  | 'diffRemoved'
  | 'diffContext'
  | 'diffHunkHeader'
  | 'diffHighlightAdded'
  | 'diffHighlightRemoved'
  | 'diffAddedBg'
  | 'diffRemovedBg'
  | 'diffContextBg'
  | 'diffLineNumber'
  | 'diffAddedLineNumberBg'
  | 'diffRemovedLineNumberBg'
  | 'markdownText'
  | 'markdownHeading'
  | 'markdownLink'
  | 'markdownLinkText'
  | 'markdownCode'
  | 'markdownBlockQuote'
  | 'markdownEmph'
  | 'markdownStrong'
  | 'markdownHorizontalRule'
  | 'markdownListItem'
  | 'markdownListEnumeration'
  | 'markdownImage'
  | 'markdownImageText'
  | 'markdownCodeBlock'
  | 'syntaxComment'
  | 'syntaxKeyword'
  | 'syntaxFunction'
  | 'syntaxVariable'
  | 'syntaxString'
  | 'syntaxNumber'
  | 'syntaxType'
  | 'syntaxOperator'
  | 'syntaxPunctuation'

export const TUI_COLOR_TOKENS: readonly TuiColorToken[] = [
  'primary',
  'secondary',
  'accent',
  'error',
  'warning',
  'success',
  'info',
  'text',
  'textMuted',
  'selectedListItemText',
  'background',
  'backgroundPanel',
  'backgroundElement',
  'backgroundMenu',
  'border',
  'borderActive',
  'borderSubtle',
  'diffAdded',
  'diffRemoved',
  'diffContext',
  'diffHunkHeader',
  'diffHighlightAdded',
  'diffHighlightRemoved',
  'diffAddedBg',
  'diffRemovedBg',
  'diffContextBg',
  'diffLineNumber',
  'diffAddedLineNumberBg',
  'diffRemovedLineNumberBg',
  'markdownText',
  'markdownHeading',
  'markdownLink',
  'markdownLinkText',
  'markdownCode',
  'markdownBlockQuote',
  'markdownEmph',
  'markdownStrong',
  'markdownHorizontalRule',
  'markdownListItem',
  'markdownListEnumeration',
  'markdownImage',
  'markdownImageText',
  'markdownCodeBlock',
  'syntaxComment',
  'syntaxKeyword',
  'syntaxFunction',
  'syntaxVariable',
  'syntaxString',
  'syntaxNumber',
  'syntaxType',
  'syntaxOperator',
  'syntaxPunctuation',
] as const

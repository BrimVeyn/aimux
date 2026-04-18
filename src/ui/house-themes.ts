// Hand-curated aimux house themes, full Shiki theme shape. Colors follow the
// VSCode workbench color key namespace; `settings` is a TextMate token rule
// array shared by the in-repo diff highlighter and `shiki.loadTheme`.
/* eslint-disable perfectionist/sort-objects */

import type { Theme, ThemeColorMap } from './themes'

// --- aimux --------------------------------------------------------------
//
// Teal accents on a deep blue-black background. Designed to look at home
// inside the aimux chrome.
const AIMUX_BG = '#11151b'
const AIMUX_FG = '#edf4ff'

const AIMUX_COLORS: ThemeColorMap = {
  'contrastBorder': '#3a4c60',
  'descriptionForeground': '#6b829a',
  'diffEditor.insertedLineBackground': '#1e3d2b',
  'diffEditor.removedLineBackground': '#3b1e27',
  'editor.background': AIMUX_BG,
  'editor.foreground': AIMUX_FG,
  'editor.lineHighlightBackground': '#1a2330',
  'editor.selectionBackground': '#1f3344',
  'editorCursor.foreground': '#7cd1b8',
  'editorError.foreground': '#f38ba8',
  'editorGroup.border': '#2d3f52',
  'editorGroupHeader.tabsBackground': '#16202b',
  'editorLineNumber.foreground': '#3e506a',
  'editorWarning.foreground': '#f6c177',
  'editorWidget.background': '#0b1016',
  'errorForeground': '#f38ba8',
  'focusBorder': '#7cd1b8',
  'foreground': AIMUX_FG,
  'gitDecoration.addedResourceForeground': '#8bd5ca',
  'gitDecoration.deletedResourceForeground': '#f38ba8',
  'gitDecoration.modifiedResourceForeground': '#f6c177',
  'gitDecoration.untrackedResourceForeground': '#8bd5ca',
  'input.background': '#1c2734',
  'input.border': '#2d3f52',
  'input.foreground': AIMUX_FG,
  'list.activeSelectionBackground': '#1f3344',
  'list.activeSelectionForeground': AIMUX_FG,
  'list.hoverBackground': '#1a2330',
  'panel.background': '#16202b',
  'panel.border': '#2d3f52',
  'sideBar.background': '#16202b',
  'sideBar.foreground': AIMUX_FG,
  'sideBarSectionHeader.background': '#1c2734',
  'sideBarSectionHeader.foreground': '#b8c5d6',
  'terminal.ansiBlue': '#7cb3ff',
  'terminal.ansiCyan': '#7cd1b8',
  'terminal.ansiGreen': '#8bd5ca',
  'terminal.ansiMagenta': '#c4a7e7',
  'terminal.ansiRed': '#f38ba8',
  'terminal.ansiYellow': '#f6c177',
  'textLink.activeForeground': '#7cd1b8',
  'textLink.foreground': '#7cd1b8',
}

// --- dracula-at-night --------------------------------------------------
const DAN_BG = '#0e1419'
const DAN_FG = '#f8f8f2'

const DAN_COLORS: ThemeColorMap = {
  'contrastBorder': '#44475a',
  'descriptionForeground': '#6272a4',
  'diffEditor.insertedLineBackground': '#162b1d',
  'diffEditor.removedLineBackground': '#2a1820',
  'editor.background': DAN_BG,
  'editor.foreground': DAN_FG,
  'editor.lineHighlightBackground': '#1a2129',
  'editor.selectionBackground': '#222a33',
  'editorCursor.foreground': '#f8f8f0',
  'editorError.foreground': '#ff5555',
  'editorGroup.border': '#2a3440',
  'editorGroupHeader.tabsBackground': '#131920',
  'editorLineNumber.foreground': '#495466',
  'editorWarning.foreground': '#f1fa8c',
  'editorWidget.background': '#090d11',
  'errorForeground': '#ff5555',
  'focusBorder': '#bd93f9',
  'foreground': DAN_FG,
  'gitDecoration.addedResourceForeground': '#50fa7b',
  'gitDecoration.deletedResourceForeground': '#ff5555',
  'gitDecoration.modifiedResourceForeground': '#f1fa8c',
  'gitDecoration.untrackedResourceForeground': '#50fa7b',
  'input.background': '#1a2129',
  'input.border': '#2a3440',
  'input.foreground': DAN_FG,
  'list.activeSelectionBackground': '#222a33',
  'list.activeSelectionForeground': DAN_FG,
  'list.hoverBackground': '#1a2129',
  'panel.background': '#131920',
  'panel.border': '#2a3440',
  'sideBar.background': '#131920',
  'sideBar.foreground': DAN_FG,
  'sideBarSectionHeader.background': '#1a2129',
  'sideBarSectionHeader.foreground': '#bdc3cf',
  'terminal.ansiBlue': '#6272a4',
  'terminal.ansiCyan': '#8be9fd',
  'terminal.ansiGreen': '#50fa7b',
  'terminal.ansiMagenta': '#ff79c6',
  'terminal.ansiRed': '#ff5555',
  'terminal.ansiYellow': '#f1fa8c',
  'textLink.activeForeground': '#ff79c6',
  'textLink.foreground': '#bd93f9',
}

// --- Shared TextMate rule helpers --------------------------------------

const AIMUX_SETTINGS = [
  { settings: { background: AIMUX_BG, foreground: AIMUX_FG } },
  {
    scope: ['comment', 'punctuation.definition.comment'],
    settings: { fontStyle: 'italic', foreground: '#6b829a' },
  },
  { scope: ['comment.documentation'], settings: { foreground: '#8fa6bf', fontStyle: 'italic' } },
  { scope: ['string', 'string.quoted'], settings: { foreground: '#f6c177' } },
  { scope: ['string.template'], settings: { foreground: '#f6c177' } },
  {
    scope: ['string.regexp', 'string.escape', 'constant.character.escape'],
    settings: { foreground: '#c4a7e7' },
  },
  {
    scope: ['constant.numeric', 'constant.language', 'constant.language.boolean'],
    settings: { foreground: '#f38ba8' },
  },
  { scope: ['constant.character', 'constant.other'], settings: { foreground: '#f38ba8' } },
  {
    scope: ['keyword', 'keyword.control', 'keyword.operator.new', 'keyword.other'],
    settings: { fontStyle: 'bold', foreground: '#c4a7e7' },
  },
  {
    scope: ['storage', 'storage.type', 'storage.modifier'],
    settings: { fontStyle: 'bold', foreground: '#c4a7e7' },
  },
  {
    scope: ['keyword.operator', 'punctuation', 'meta.brace', 'punctuation.separator'],
    settings: { foreground: '#6b829a' },
  },
  {
    scope: [
      'entity.name.function',
      'support.function',
      'meta.function-call',
      'entity.name.function.member',
    ],
    settings: { foreground: '#8bd5ca' },
  },
  {
    scope: [
      'entity.name.type',
      'support.type',
      'support.class',
      'entity.name.class',
      'entity.name.interface',
      'entity.name.namespace',
    ],
    settings: { fontStyle: 'italic', foreground: '#7cd1b8' },
  },
  {
    scope: ['entity.name.type.enum', 'entity.name.type.alias'],
    settings: { foreground: '#7cd1b8' },
  },
  { scope: ['variable', 'meta.variable'], settings: { foreground: AIMUX_FG } },
  {
    scope: ['variable.parameter', 'meta.function.parameters'],
    settings: { fontStyle: 'italic', foreground: AIMUX_FG },
  },
  {
    scope: ['variable.other.property', 'variable.other.member', 'meta.object-literal.key'],
    settings: { foreground: '#7cd1b8' },
  },
  {
    scope: ['variable.language', 'variable.language.this'],
    settings: { foreground: '#f38ba8', fontStyle: 'italic' },
  },
  { scope: ['entity.name.tag', 'meta.tag'], settings: { foreground: '#f38ba8' } },
  {
    scope: ['entity.other.attribute-name'],
    settings: { fontStyle: 'italic', foreground: '#f6c177' },
  },
  { scope: ['support.constant'], settings: { foreground: '#f38ba8' } },
  { scope: ['support.variable'], settings: { foreground: AIMUX_FG } },
  // Markdown
  { scope: ['markup.heading'], settings: { fontStyle: 'bold', foreground: '#7cd1b8' } },
  { scope: ['markup.bold'], settings: { fontStyle: 'bold', foreground: AIMUX_FG } },
  { scope: ['markup.italic'], settings: { fontStyle: 'italic', foreground: AIMUX_FG } },
  { scope: ['markup.underline.link', 'markup.inline.raw'], settings: { foreground: '#8bd5ca' } },
  { scope: ['markup.list'], settings: { foreground: '#c4a7e7' } },
  { scope: ['markup.quote'], settings: { foreground: '#6b829a', fontStyle: 'italic' } },
  { scope: ['markup.raw'], settings: { foreground: '#f6c177' } },
  // JSX / TSX
  {
    scope: ['entity.name.tag.jsx', 'support.class.component'],
    settings: { foreground: '#7cd1b8' },
  },
  { scope: ['meta.jsx.children'], settings: { foreground: AIMUX_FG } },
  // Diff
  { scope: ['markup.inserted', 'meta.diff.header.to-file'], settings: { foreground: '#8bd5ca' } },
  { scope: ['markup.deleted', 'meta.diff.header.from-file'], settings: { foreground: '#f38ba8' } },
  { scope: ['markup.changed'], settings: { foreground: '#f6c177' } },
  { scope: ['meta.diff.range'], settings: { foreground: '#c4a7e7' } },
]

const DAN_SETTINGS = [
  { settings: { background: DAN_BG, foreground: DAN_FG } },
  {
    scope: ['comment', 'punctuation.definition.comment'],
    settings: { fontStyle: 'italic', foreground: '#6272a4' },
  },
  { scope: ['comment.documentation'], settings: { fontStyle: 'italic', foreground: '#8a96b4' } },
  { scope: ['string', 'string.quoted'], settings: { foreground: '#f1fa8c' } },
  { scope: ['string.template'], settings: { foreground: '#f1fa8c' } },
  {
    scope: ['string.regexp', 'string.escape', 'constant.character.escape'],
    settings: { foreground: '#ff79c6' },
  },
  {
    scope: ['constant.numeric', 'constant.language', 'constant.language.boolean'],
    settings: { foreground: '#bd93f9' },
  },
  { scope: ['constant.character', 'constant.other'], settings: { foreground: '#bd93f9' } },
  {
    scope: ['keyword', 'keyword.control', 'keyword.other'],
    settings: { fontStyle: 'bold', foreground: '#ff79c6' },
  },
  {
    scope: ['storage', 'storage.type', 'storage.modifier'],
    settings: { fontStyle: 'bold italic', foreground: '#ff79c6' },
  },
  {
    scope: ['keyword.operator', 'punctuation', 'meta.brace', 'punctuation.separator'],
    settings: { foreground: '#f8f8f2' },
  },
  {
    scope: ['entity.name.function', 'support.function', 'meta.function-call'],
    settings: { foreground: '#50fa7b' },
  },
  {
    scope: [
      'entity.name.type',
      'support.type',
      'support.class',
      'entity.name.class',
      'entity.name.interface',
    ],
    settings: { fontStyle: 'italic', foreground: '#8be9fd' },
  },
  {
    scope: ['entity.name.type.enum', 'entity.name.type.alias'],
    settings: { foreground: '#8be9fd' },
  },
  { scope: ['variable', 'meta.variable'], settings: { foreground: DAN_FG } },
  {
    scope: ['variable.parameter', 'meta.function.parameters'],
    settings: { fontStyle: 'italic', foreground: '#ffb86c' },
  },
  {
    scope: ['variable.other.property', 'variable.other.member', 'meta.object-literal.key'],
    settings: { foreground: '#8be9fd' },
  },
  {
    scope: ['variable.language', 'variable.language.this'],
    settings: { foreground: '#bd93f9', fontStyle: 'italic' },
  },
  { scope: ['entity.name.tag', 'meta.tag'], settings: { foreground: '#ff79c6' } },
  {
    scope: ['entity.other.attribute-name'],
    settings: { fontStyle: 'italic', foreground: '#50fa7b' },
  },
  { scope: ['support.constant'], settings: { foreground: '#bd93f9' } },
  // Markdown
  { scope: ['markup.heading'], settings: { fontStyle: 'bold', foreground: '#bd93f9' } },
  { scope: ['markup.bold'], settings: { fontStyle: 'bold', foreground: '#ffb86c' } },
  { scope: ['markup.italic'], settings: { fontStyle: 'italic', foreground: '#f1fa8c' } },
  { scope: ['markup.underline.link', 'markup.inline.raw'], settings: { foreground: '#8be9fd' } },
  { scope: ['markup.list'], settings: { foreground: '#ff79c6' } },
  { scope: ['markup.quote'], settings: { foreground: '#6272a4', fontStyle: 'italic' } },
  { scope: ['markup.raw'], settings: { foreground: '#f1fa8c' } },
  // JSX / TSX
  {
    scope: ['entity.name.tag.jsx', 'support.class.component'],
    settings: { foreground: '#8be9fd' },
  },
  // Diff
  { scope: ['markup.inserted'], settings: { foreground: '#50fa7b' } },
  { scope: ['markup.deleted'], settings: { foreground: '#ff5555' } },
  { scope: ['markup.changed'], settings: { foreground: '#f1fa8c' } },
]

export const HOUSE_THEMES: Record<string, Theme> = {
  'aimux': {
    bg: AIMUX_BG,
    colors: AIMUX_COLORS,
    displayName: 'Aimux',
    fg: AIMUX_FG,
    name: 'aimux',
    settings: AIMUX_SETTINGS,
    type: 'dark',
  },
  'dracula-at-night': {
    bg: DAN_BG,
    colors: DAN_COLORS,
    displayName: 'Dracula At Night',
    fg: DAN_FG,
    name: 'dracula-at-night',
    settings: DAN_SETTINGS,
    type: 'dark',
  },
}

export const HOUSE_THEME_IDS: string[] = Object.keys(HOUSE_THEMES)

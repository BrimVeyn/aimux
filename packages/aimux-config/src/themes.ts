import type { ThemeColors, ThemeDefinition, ThemeId } from './types'

export const THEME_IDS: ThemeId[] = [
  'catppuccin-mocha',
  'dracula',
  'nord',
  'one-dark-pro',
  'solarized-dark',
  'tokyo-night',
]

export const THEMES: Record<ThemeId, { name: string; colors: ThemeColors }> = {
  'catppuccin-mocha': {
    colors: {
      accent: '#89b4fa',
      accentAlt: '#cba6f7',
      background: '#1e1e2e',
      border: '#45475a',
      borderActive: '#89b4fa',
      danger: '#f38ba8',
      dim: '#313244',
      overlay: '#11111b',
      panel: '#181825',
      panelHighlight: '#313244',
      panelMuted: '#1e1e2e',
      success: '#a6e3a1',
      text: '#cdd6f4',
      textMuted: '#7f849c',
      warning: '#f9e2af',
    },
    name: 'Catppuccin Mocha',
  },
  'dracula': {
    colors: {
      accent: '#bd93f9',
      accentAlt: '#ff79c6',
      background: '#282a36',
      border: '#44475a',
      borderActive: '#bd93f9',
      danger: '#ff5555',
      dim: '#343746',
      overlay: '#1f2029',
      panel: '#21222c',
      panelHighlight: '#44475a',
      panelMuted: '#282a36',
      success: '#50fa7b',
      text: '#f8f8f2',
      textMuted: '#6272a4',
      warning: '#f1fa8c',
    },
    name: 'Dracula',
  },
  'nord': {
    colors: {
      accent: '#88c0d0',
      accentAlt: '#b48ead',
      background: '#2e3440',
      border: '#434c5e',
      borderActive: '#88c0d0',
      danger: '#bf616a',
      dim: '#3b4252',
      overlay: '#242933',
      panel: '#3b4252',
      panelHighlight: '#434c5e',
      panelMuted: '#2e3440',
      success: '#a3be8c',
      text: '#eceff4',
      textMuted: '#6c7a96',
      warning: '#ebcb8b',
    },
    name: 'Nord',
  },
  'one-dark-pro': {
    colors: {
      accent: '#61afef',
      accentAlt: '#c678dd',
      background: '#282c34',
      border: '#3e4451',
      borderActive: '#61afef',
      danger: '#e06c75',
      dim: '#3a3f4b',
      overlay: '#21252b',
      panel: '#21252b',
      panelHighlight: '#2c313c',
      panelMuted: '#282c34',
      success: '#98c379',
      text: '#abb2bf',
      textMuted: '#5c6370',
      warning: '#e5c07b',
    },
    name: 'One Dark Pro',
  },
  'solarized-dark': {
    colors: {
      accent: '#268bd2',
      accentAlt: '#6c71c4',
      background: '#002b36',
      border: '#073642',
      borderActive: '#268bd2',
      danger: '#dc322f',
      dim: '#0a3e4a',
      overlay: '#001e26',
      panel: '#073642',
      panelHighlight: '#0a4553',
      panelMuted: '#002b36',
      success: '#859900',
      text: '#93a1a1',
      textMuted: '#586e75',
      warning: '#b58900',
    },
    name: 'Solarized Dark',
  },
  'tokyo-night': {
    colors: {
      accent: '#7aa2f7',
      accentAlt: '#bb9af7',
      background: '#1a1b26',
      border: '#292e42',
      borderActive: '#7aa2f7',
      danger: '#f7768e',
      dim: '#24283b',
      overlay: '#16161e',
      panel: '#16161e',
      panelHighlight: '#292e42',
      panelMuted: '#1a1b26',
      success: '#9ece6a',
      text: '#c0caf5',
      textMuted: '#565f89',
      warning: '#e0af68',
    },
    name: 'Tokyo Night',
  },
}

const LEGACY_THEME_ALIASES: Record<string, ThemeId> = {
  'aimux': 'catppuccin-mocha',
  'dracula-at-night': 'dracula',
  'everforest': 'catppuccin-mocha',
  'gruvbox-dark': 'catppuccin-mocha',
  'kanagawa': 'tokyo-night',
  'one-dark': 'one-dark-pro',
}

export function migrateThemeId(id: string | undefined): ThemeId {
  if (id !== undefined && id in THEMES) return id as ThemeId
  if (id !== undefined) {
    const alias = LEGACY_THEME_ALIASES[id]
    if (alias !== undefined) return alias
  }
  return 'catppuccin-mocha'
}

export const themes = {
  extend(base: ThemeId, overrides: Partial<ThemeColors>): ThemeDefinition {
    const baseTheme = THEMES[base]
    if (!baseTheme) {
      throw new Error(`themes.extend: unknown base theme "${base}"`)
    }
    return {
      base,
      colors: { ...baseTheme.colors, ...overrides },
    }
  },
}

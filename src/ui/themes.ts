export interface ThemeColors {
  background: string
  panel: string
  panelMuted: string
  panelHighlight: string
  border: string
  borderActive: string
  text: string
  textMuted: string
  accent: string
  accentAlt: string
  warning: string
  danger: string
  success: string
  dim: string
}

export type ThemeId =
  | 'aimux'
  | 'dracula'
  | 'tokyo-night'
  | 'gruvbox-dark'
  | 'catppuccin-mocha'
  | 'nord'
  | 'solarized-dark'
  | 'one-dark'
  | 'kanagawa'

export const THEMES: Record<ThemeId, { name: string; colors: ThemeColors }> = {
  'aimux': {
    name: 'Aimux',
    colors: {
      background: '#11151b',
      panel: '#16202b',
      panelMuted: '#1c2734',
      panelHighlight: '#1f3344',
      border: '#2d3f52',
      borderActive: '#7cd1b8',
      text: '#edf4ff',
      textMuted: '#6b829a',
      accent: '#7cd1b8',
      accentAlt: '#c4a7e7',
      warning: '#f6c177',
      danger: '#f38ba8',
      success: '#8bd5ca',
      dim: '#243242',
    },
  },
  'dracula': {
    name: 'Dracula',
    colors: {
      background: '#282a36',
      panel: '#2d2f3d',
      panelMuted: '#343746',
      panelHighlight: '#3d4056',
      border: '#44475a',
      borderActive: '#bd93f9',
      text: '#f8f8f2',
      textMuted: '#6272a4',
      accent: '#bd93f9',
      accentAlt: '#ff79c6',
      warning: '#f1fa8c',
      danger: '#ff5555',
      success: '#50fa7b',
      dim: '#383a4a',
    },
  },
  'tokyo-night': {
    name: 'Tokyo Night',
    colors: {
      background: '#1a1b26',
      panel: '#1f2335',
      panelMuted: '#24283b',
      panelHighlight: '#292e42',
      border: '#3b4261',
      borderActive: '#7aa2f7',
      text: '#c0caf5',
      textMuted: '#565f89',
      accent: '#7aa2f7',
      accentAlt: '#bb9af7',
      warning: '#e0af68',
      danger: '#f7768e',
      success: '#9ece6a',
      dim: '#292e42',
    },
  },
  'gruvbox-dark': {
    name: 'Gruvbox Dark',
    colors: {
      background: '#282828',
      panel: '#2e2e2e',
      panelMuted: '#3c3836',
      panelHighlight: '#504945',
      border: '#504945',
      borderActive: '#b8bb26',
      text: '#ebdbb2',
      textMuted: '#928374',
      accent: '#b8bb26',
      accentAlt: '#d3869b',
      warning: '#fabd2f',
      danger: '#fb4934',
      success: '#b8bb26',
      dim: '#3c3836',
    },
  },
  'catppuccin-mocha': {
    name: 'Catppuccin Mocha',
    colors: {
      background: '#1e1e2e',
      panel: '#232334',
      panelMuted: '#2a2a3c',
      panelHighlight: '#313244',
      border: '#45475a',
      borderActive: '#cba6f7',
      text: '#cdd6f4',
      textMuted: '#6c7086',
      accent: '#cba6f7',
      accentAlt: '#f5c2e7',
      warning: '#f9e2af',
      danger: '#f38ba8',
      success: '#a6e3a1',
      dim: '#313244',
    },
  },
  'nord': {
    name: 'Nord',
    colors: {
      background: '#2e3440',
      panel: '#333a47',
      panelMuted: '#3b4252',
      panelHighlight: '#434c5e',
      border: '#434c5e',
      borderActive: '#88c0d0',
      text: '#eceff4',
      textMuted: '#7b88a1',
      accent: '#88c0d0',
      accentAlt: '#b48ead',
      warning: '#ebcb8b',
      danger: '#bf616a',
      success: '#a3be8c',
      dim: '#3b4252',
    },
  },
  'solarized-dark': {
    name: 'Solarized Dark',
    colors: {
      background: '#002b36',
      panel: '#003340',
      panelMuted: '#073642',
      panelHighlight: '#0a4050',
      border: '#2e5560',
      borderActive: '#268bd2',
      text: '#fdf6e3',
      textMuted: '#657b83',
      accent: '#268bd2',
      accentAlt: '#d33682',
      warning: '#b58900',
      danger: '#dc322f',
      success: '#859900',
      dim: '#073642',
    },
  },
  'one-dark': {
    name: 'One Dark',
    colors: {
      background: '#282c34',
      panel: '#2c313a',
      panelMuted: '#333842',
      panelHighlight: '#3b4048',
      border: '#3e4452',
      borderActive: '#61afef',
      text: '#abb2bf',
      textMuted: '#636d83',
      accent: '#61afef',
      accentAlt: '#c678dd',
      warning: '#e5c07b',
      danger: '#e06c75',
      success: '#98c379',
      dim: '#3b4048',
    },
  },
  'kanagawa': {
    name: 'Kanagawa',
    colors: {
      background: '#1f1f28',
      panel: '#24242e',
      panelMuted: '#2a2a37',
      panelHighlight: '#363646',
      border: '#363646',
      borderActive: '#7e9cd8',
      text: '#dcd7ba',
      textMuted: '#727169',
      accent: '#7e9cd8',
      accentAlt: '#957fb8',
      warning: '#e6c384',
      danger: '#e82424',
      success: '#76946a',
      dim: '#2a2a37',
    },
  },
}

export const THEME_IDS = Object.keys(THEMES) as ThemeId[]

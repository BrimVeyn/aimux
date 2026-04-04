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
  | 'dracula-at-night'
  | 'tokyo-night'
  | 'gruvbox-dark'
  | 'catppuccin-mocha'
  | 'nord'
  | 'solarized-dark'
  | 'one-dark'
  | 'kanagawa'

export const THEMES: Record<ThemeId, { name: string; colors: ThemeColors }> = {
  'aimux': {
    colors: {
      accent: '#7cd1b8',
      accentAlt: '#c4a7e7',
      background: '#11151b',
      border: '#2d3f52',
      borderActive: '#7cd1b8',
      danger: '#f38ba8',
      dim: '#243242',
      panel: '#16202b',
      panelHighlight: '#1f3344',
      panelMuted: '#1c2734',
      success: '#8bd5ca',
      text: '#edf4ff',
      textMuted: '#6b829a',
      warning: '#f6c177',
    },
    name: 'Aimux',
  },
  'catppuccin-mocha': {
    colors: {
      accent: '#cba6f7',
      accentAlt: '#f5c2e7',
      background: '#1e1e2e',
      border: '#45475a',
      borderActive: '#cba6f7',
      danger: '#f38ba8',
      dim: '#313244',
      panel: '#232334',
      panelHighlight: '#313244',
      panelMuted: '#2a2a3c',
      success: '#a6e3a1',
      text: '#cdd6f4',
      textMuted: '#6c7086',
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
      dim: '#383a4a',
      panel: '#2d2f3d',
      panelHighlight: '#3d4056',
      panelMuted: '#343746',
      success: '#50fa7b',
      text: '#f8f8f2',
      textMuted: '#6272a4',
      warning: '#f1fa8c',
    },
    name: 'Dracula',
  },
  'dracula-at-night': {
    colors: {
      accent: '#bd93f9',
      accentAlt: '#ff79c6',
      background: '#0e1419',
      border: '#2a3440',
      borderActive: '#bd93f9',
      danger: '#ff5555',
      dim: '#1e2630',
      panel: '#131920',
      panelHighlight: '#222a33',
      panelMuted: '#1a2129',
      success: '#50fa7b',
      text: '#f8f8f2',
      textMuted: '#6272a4',
      warning: '#f1fa8c',
    },
    name: 'Dracula At Night',
  },
  'gruvbox-dark': {
    colors: {
      accent: '#b8bb26',
      accentAlt: '#d3869b',
      background: '#282828',
      border: '#504945',
      borderActive: '#b8bb26',
      danger: '#fb4934',
      dim: '#3c3836',
      panel: '#2e2e2e',
      panelHighlight: '#504945',
      panelMuted: '#3c3836',
      success: '#b8bb26',
      text: '#ebdbb2',
      textMuted: '#928374',
      warning: '#fabd2f',
    },
    name: 'Gruvbox Dark',
  },
  'kanagawa': {
    colors: {
      accent: '#7e9cd8',
      accentAlt: '#957fb8',
      background: '#1f1f28',
      border: '#363646',
      borderActive: '#7e9cd8',
      danger: '#e82424',
      dim: '#2a2a37',
      panel: '#24242e',
      panelHighlight: '#363646',
      panelMuted: '#2a2a37',
      success: '#76946a',
      text: '#dcd7ba',
      textMuted: '#727169',
      warning: '#e6c384',
    },
    name: 'Kanagawa',
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
      panel: '#333a47',
      panelHighlight: '#434c5e',
      panelMuted: '#3b4252',
      success: '#a3be8c',
      text: '#eceff4',
      textMuted: '#7b88a1',
      warning: '#ebcb8b',
    },
    name: 'Nord',
  },
  'one-dark': {
    colors: {
      accent: '#61afef',
      accentAlt: '#c678dd',
      background: '#282c34',
      border: '#3e4452',
      borderActive: '#61afef',
      danger: '#e06c75',
      dim: '#3b4048',
      panel: '#2c313a',
      panelHighlight: '#3b4048',
      panelMuted: '#333842',
      success: '#98c379',
      text: '#abb2bf',
      textMuted: '#636d83',
      warning: '#e5c07b',
    },
    name: 'One Dark',
  },
  'solarized-dark': {
    colors: {
      accent: '#268bd2',
      accentAlt: '#d33682',
      background: '#002b36',
      border: '#2e5560',
      borderActive: '#268bd2',
      danger: '#dc322f',
      dim: '#073642',
      panel: '#003340',
      panelHighlight: '#0a4050',
      panelMuted: '#073642',
      success: '#859900',
      text: '#fdf6e3',
      textMuted: '#657b83',
      warning: '#b58900',
    },
    name: 'Solarized Dark',
  },
  'tokyo-night': {
    colors: {
      accent: '#7aa2f7',
      accentAlt: '#bb9af7',
      background: '#1a1b26',
      border: '#3b4261',
      borderActive: '#7aa2f7',
      danger: '#f7768e',
      dim: '#292e42',
      panel: '#1f2335',
      panelHighlight: '#292e42',
      panelMuted: '#24283b',
      success: '#9ece6a',
      text: '#c0caf5',
      textMuted: '#565f89',
      warning: '#e0af68',
    },
    name: 'Tokyo Night',
  },
}

export const THEME_IDS = Object.keys(THEMES) as ThemeId[]

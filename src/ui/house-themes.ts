// Hand-curated aimux house themes. Not part of the shiki catalog; the diff
// renderer synthesizes a shiki theme from these palettes via
// src/ui/synth-shiki-theme.ts.

import type { ThemeColors } from './themes'

export const HOUSE_THEMES: Record<string, { colors: ThemeColors; name: string; type: 'dark' }> = {
  'aimux': {
    colors: {
      accent: '#7cd1b8',
      accentAlt: '#c4a7e7',
      background: '#11151b',
      border: '#2d3f52',
      borderActive: '#7cd1b8',
      danger: '#f38ba8',
      diffAddBg: '#1e3d2b',
      diffRemoveBg: '#3b1e27',
      dim: '#243242',
      overlay: '#0b1016',
      panel: '#16202b',
      panelHighlight: '#1f3344',
      panelMuted: '#1c2734',
      success: '#8bd5ca',
      text: '#edf4ff',
      textMuted: '#6b829a',
      warning: '#f6c177',
    },
    name: 'Aimux',
    type: 'dark',
  },
  'dracula-at-night': {
    colors: {
      accent: '#bd93f9',
      accentAlt: '#ff79c6',
      background: '#0e1419',
      border: '#2a3440',
      borderActive: '#bd93f9',
      danger: '#ff5555',
      diffAddBg: '#162b1d',
      diffRemoveBg: '#2a1820',
      dim: '#1e2630',
      overlay: '#090d11',
      panel: '#131920',
      panelHighlight: '#222a33',
      panelMuted: '#1a2129',
      success: '#50fa7b',
      text: '#f8f8f2',
      textMuted: '#6272a4',
      warning: '#f1fa8c',
    },
    name: 'Dracula At Night',
    type: 'dark',
  },
}

export const HOUSE_THEME_IDS: string[] = Object.keys(HOUSE_THEMES)

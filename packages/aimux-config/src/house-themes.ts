// Hand-curated aimux house palettes. The opencode-style semantic palette
// drives both UI chrome and the runtime-generated Shiki theme — see
// `palette-to-shiki.ts`.
/* eslint-disable perfectionist/sort-objects */

import type { AimuxPalette, AimuxTheme } from './types'

const AIMUX_DARK_PALETTE: AimuxPalette = {
  neutral: '#11151b',
  ink: '#edf4ff',
  primary: '#7cd1b8',
  success: '#8bd5ca',
  warning: '#f6c177',
  error: '#f38ba8',
  info: '#7cb3ff',
  accent: '#c4a7e7',
  interactive: '#1f3344',
  diffAdd: '#1e3d2b',
  diffDelete: '#3b1e27',
}

const AIMUX_LIGHT_PALETTE: AimuxPalette = {
  neutral: '#f7f9fc',
  ink: '#11151b',
  primary: '#1f8a72',
  success: '#2e9a83',
  warning: '#b8770f',
  error: '#c43b58',
  info: '#2e6cc1',
  accent: '#7d57b8',
  interactive: '#dbe6f0',
  diffAdd: '#d4ebd9',
  diffDelete: '#f0d6dc',
}

export const HOUSE_THEMES: Record<string, AimuxTheme> = {
  'aimux-dark': {
    name: 'aimux',
    mode: 'dark',
    displayName: 'Aimux Dark',
    palette: AIMUX_DARK_PALETTE,
    fg: AIMUX_DARK_PALETTE.ink,
    bg: AIMUX_DARK_PALETTE.neutral,
  },
  'aimux-light': {
    name: 'aimux',
    mode: 'light',
    displayName: 'Aimux Light',
    palette: AIMUX_LIGHT_PALETTE,
    fg: AIMUX_LIGHT_PALETTE.ink,
    bg: AIMUX_LIGHT_PALETTE.neutral,
  },
}

export const HOUSE_THEME_IDS: string[] = ['aimux-dark', 'aimux-light']

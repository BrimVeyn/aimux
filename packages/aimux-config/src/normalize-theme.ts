// Normalize a partial theme input into a full aimux `Theme` where every
// AIMUX_COLOR_KEY is guaranteed to have a value. Used at build time by the
// generator script and at runtime by registerUserThemes — same code path, same
// guarantees.

import {
  AIMUX_COLOR_KEYS,
  type AimuxColorKey,
  type Theme,
  type ThemeColorMap,
  type ThemeTokenRule,
} from './types'

export interface NormalizeInput {
  name: string
  displayName?: string
  type?: 'dark' | 'light'
  fg?: string
  bg?: string
  colors?: Record<string, string | null | undefined>
  settings?: ThemeTokenRule[]
  tokenColors?: ThemeTokenRule[]
  colorReplacements?: Record<string, string>
  semanticHighlighting?: boolean
  semanticTokenColors?: Theme['semanticTokenColors']
}

function stripAlpha(hex: string | null | undefined): string {
  if (!hex || typeof hex !== 'string') return '#000000'
  if (hex.length === 9) return hex.slice(0, 7)
  if (hex.length === 5) return hex.slice(0, 4)
  return hex
}

function expand3(hex: string): string {
  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
  }
  return hex
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  const clean = expand3(stripAlpha(hex))
  return {
    b: parseInt(clean.slice(5, 7), 16),
    g: parseInt(clean.slice(3, 5), 16),
    r: parseInt(clean.slice(1, 3), 16),
  }
}

function toHex({ b, g, r }: { b: number; g: number; r: number }): string {
  const clamp = (n: number): number => Math.max(0, Math.min(255, Math.round(n)))
  const h = (n: number): string => clamp(n).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

export function shade(hex: string, amount: number): string {
  const { b, g, r } = parseHex(hex)
  const d = amount * 255
  return toHex({ b: b + d, g: g + d, r: r + d })
}

export function mix(a: string, b: string, t: number): string {
  const ca = parseHex(a)
  const cb = parseHex(b)
  return toHex({
    b: ca.b + (cb.b - ca.b) * t,
    g: ca.g + (cb.g - ca.g) * t,
    r: ca.r + (cb.r - ca.r) * t,
  })
}

function first(map: Record<string, string | null | undefined>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = map[k]
    if (v && typeof v === 'string') return stripAlpha(v)
  }
  return undefined
}

const FALLBACKS: Record<AimuxColorKey, string[]> = {
  'contrastBorder': ['editorGroup.border'],
  'descriptionForeground': ['editorLineNumber.foreground', 'foreground'],
  'diffEditor.insertedLineBackground': [],
  'diffEditor.removedLineBackground': [],
  'editor.background': [],
  'editor.foreground': [],
  'editor.lineHighlightBackground': [],
  'editor.selectionBackground': ['selection.background'],
  'editorCursor.foreground': ['editor.foreground'],
  'editorError.foreground': ['errorForeground', 'terminal.ansiRed'],
  'editorGroup.border': ['contrastBorder', 'panel.border'],
  'editorGroupHeader.tabsBackground': ['sideBar.background'],
  'editorLineNumber.foreground': ['descriptionForeground'],
  'editorWarning.foreground': ['terminal.ansiYellow'],
  'editorWidget.background': ['sideBar.background', 'editor.background'],
  'errorForeground': ['editorError.foreground', 'terminal.ansiRed'],
  'focusBorder': ['textLink.foreground'],
  'foreground': ['editor.foreground'],
  'gitDecoration.addedResourceForeground': ['terminal.ansiGreen'],
  'gitDecoration.deletedResourceForeground': ['terminal.ansiRed', 'editorError.foreground'],
  'gitDecoration.modifiedResourceForeground': ['terminal.ansiYellow'],
  'gitDecoration.untrackedResourceForeground': ['gitDecoration.addedResourceForeground'],
  'input.background': ['editorWidget.background'],
  'input.border': ['focusBorder', 'editorGroup.border'],
  'input.foreground': ['editor.foreground'],
  'list.activeSelectionBackground': ['editor.selectionBackground'],
  'list.activeSelectionForeground': ['editor.foreground'],
  'list.hoverBackground': ['list.activeSelectionBackground'],
  'panel.background': ['editor.background'],
  'panel.border': ['editorGroup.border', 'contrastBorder'],
  'sideBar.background': ['editorGroupHeader.tabsBackground', 'panel.background'],
  'sideBar.foreground': ['editor.foreground', 'foreground'],
  'sideBarSectionHeader.background': ['sideBar.background'],
  'sideBarSectionHeader.foreground': ['sideBar.foreground'],
  'terminal.ansiBlue': ['textLink.foreground'],
  'terminal.ansiCyan': [],
  'terminal.ansiGreen': ['gitDecoration.addedResourceForeground'],
  'terminal.ansiMagenta': [],
  'terminal.ansiRed': ['editorError.foreground'],
  'terminal.ansiYellow': ['editorWarning.foreground'],
  'textLink.activeForeground': ['textLink.foreground'],
  'textLink.foreground': ['editorLink.activeForeground', 'terminal.ansiBlue'],
}

function computeFallback(
  key: AimuxColorKey,
  bg: string,
  fg: string,
  resolved: ThemeColorMap
): string {
  switch (key) {
    case 'editor.background':
      return bg
    case 'editor.foreground':
      return fg
    case 'editor.lineHighlightBackground':
      return shade(bg, 0.03)
    case 'editor.selectionBackground':
      return shade(bg, 0.1)
    case 'editorCursor.foreground':
      return fg
    case 'editorLineNumber.foreground':
      return mix(fg, bg, 0.55)
    case 'sideBar.background':
      return shade(bg, -0.04)
    case 'sideBar.foreground':
      return fg
    case 'sideBarSectionHeader.background':
      return shade(bg, -0.02)
    case 'sideBarSectionHeader.foreground':
      return mix(fg, bg, 0.35)
    case 'editorGroupHeader.tabsBackground':
      return shade(bg, -0.04)
    case 'editorWidget.background':
      return shade(bg, -0.08)
    case 'panel.background':
      return bg
    case 'panel.border':
      return shade(bg, 0.15)
    case 'focusBorder':
      return resolved['textLink.foreground'] ?? fg
    case 'editorGroup.border':
      return shade(bg, 0.15)
    case 'contrastBorder':
      return shade(bg, 0.2)
    case 'list.activeSelectionBackground':
      return shade(bg, 0.1)
    case 'list.activeSelectionForeground':
      return fg
    case 'list.hoverBackground':
      return shade(bg, 0.05)
    case 'foreground':
      return fg
    case 'descriptionForeground':
      return mix(fg, bg, 0.55)
    case 'textLink.foreground':
    case 'textLink.activeForeground':
      return resolved['terminal.ansiBlue'] ?? fg
    case 'errorForeground':
    case 'editorError.foreground':
      return '#f38ba8'
    case 'editorWarning.foreground':
      return '#f6c177'
    case 'terminal.ansiRed':
      return '#f38ba8'
    case 'terminal.ansiGreen':
      return '#8bd5ca'
    case 'terminal.ansiYellow':
      return '#f6c177'
    case 'terminal.ansiBlue':
      return '#7cd1b8'
    case 'terminal.ansiMagenta':
      return resolved['textLink.activeForeground'] ?? '#c4a7e7'
    case 'terminal.ansiCyan':
      return resolved['terminal.ansiBlue'] ?? '#89dceb'
    case 'gitDecoration.addedResourceForeground':
      return resolved['terminal.ansiGreen'] ?? '#8bd5ca'
    case 'gitDecoration.modifiedResourceForeground':
      return resolved['terminal.ansiYellow'] ?? '#f6c177'
    case 'gitDecoration.deletedResourceForeground':
      return resolved['terminal.ansiRed'] ?? '#f38ba8'
    case 'gitDecoration.untrackedResourceForeground':
      return resolved['gitDecoration.addedResourceForeground'] ?? '#8bd5ca'
    case 'diffEditor.insertedLineBackground':
      return mix(bg, resolved['gitDecoration.addedResourceForeground'] ?? '#8bd5ca', 0.18)
    case 'diffEditor.removedLineBackground':
      return mix(bg, resolved['gitDecoration.deletedResourceForeground'] ?? '#f38ba8', 0.18)
    case 'input.background':
      return shade(bg, -0.04)
    case 'input.foreground':
      return fg
    case 'input.border':
      return shade(bg, 0.15)
    default:
      return fg
  }
}

export function normalizeTheme(raw: NormalizeInput): Theme {
  const srcColors = raw.colors ?? {}
  const bg = stripAlpha(srcColors['editor.background'] ?? raw.bg ?? '#000000')
  const fg = stripAlpha(srcColors['editor.foreground'] ?? raw.fg ?? '#ffffff')

  const resolved: ThemeColorMap = {} as ThemeColorMap
  for (const key of AIMUX_COLOR_KEYS) {
    const direct = srcColors[key]
    if (direct && typeof direct === 'string') {
      resolved[key] = stripAlpha(direct)
      continue
    }
    const alt = first(srcColors, FALLBACKS[key])
    if (alt) resolved[key] = alt
  }
  for (const key of AIMUX_COLOR_KEYS) {
    if (!resolved[key]) resolved[key] = computeFallback(key, bg, fg, resolved)
  }
  for (const [k, v] of Object.entries(srcColors)) {
    if (!resolved[k] && v && typeof v === 'string') resolved[k] = stripAlpha(v)
  }

  const out: Theme = {
    bg,
    colors: resolved,
    displayName: raw.displayName ?? raw.name,
    fg,
    name: raw.name,
    settings: raw.settings ?? [],
    type: raw.type ?? 'dark',
  }
  if (raw.colorReplacements && Object.keys(raw.colorReplacements).length > 0) {
    out.colorReplacements = raw.colorReplacements
  }
  if (raw.semanticHighlighting) out.semanticHighlighting = raw.semanticHighlighting
  if (raw.semanticTokenColors && Object.keys(raw.semanticTokenColors).length > 0) {
    out.semanticTokenColors = raw.semanticTokenColors
  }
  if (raw.tokenColors && raw.tokenColors !== raw.settings) out.tokenColors = raw.tokenColors
  return out
}

// Pure color-derivation utilities for mapping a Shiki theme → aimux ThemeColors.
// Consumed by scripts/generate-themes.ts; also safe to import at runtime if ever needed.

import type { ThemeRegistrationResolved } from 'shiki'

export interface PaletteColors {
  background: string
  panel: string
  panelMuted: string
  panelHighlight: string
  overlay: string
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
  diffAddBg: string
  diffRemoveBg: string
}

function stripAlpha(hex: string): string {
  if (hex.length === 9) return hex.slice(0, 7)
  if (hex.length === 5) return hex.slice(0, 4)
  return hex
}

function expand(hex: string): string {
  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
  }
  return hex
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  const clean = expand(stripAlpha(hex))
  const r = parseInt(clean.slice(1, 3), 16)
  const g = parseInt(clean.slice(3, 5), 16)
  const b = parseInt(clean.slice(5, 7), 16)
  return { b, g, r }
}

function toHex({ b, g, r }: { b: number; g: number; r: number }): string {
  const clamp = (n: number): number => Math.max(0, Math.min(255, Math.round(n)))
  const h = (n: number): string => clamp(n).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

function shade(hex: string, amount: number): string {
  const { b, g, r } = parseHex(hex)
  const d = amount * 255
  return toHex({ b: b + d, g: g + d, r: r + d })
}

function mix(a: string, b: string, t: number): string {
  const ca = parseHex(a)
  const cb = parseHex(b)
  return toHex({
    b: ca.b + (cb.b - ca.b) * t,
    g: ca.g + (cb.g - ca.g) * t,
    r: ca.r + (cb.r - ca.r) * t,
  })
}

function firstPresent(map: Record<string, string>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = map[k]
    if (v) return stripAlpha(v)
  }
  return undefined
}

const FALLBACK_WARNING = '#f6c177'
const FALLBACK_DANGER = '#f38ba8'
const FALLBACK_SUCCESS = '#8bd5ca'

export function derivePalette(theme: ThemeRegistrationResolved): PaletteColors {
  const c = theme.colors ?? {}
  const bg = stripAlpha(firstPresent(c, ['editor.background']) ?? theme.bg)
  const fg = stripAlpha(firstPresent(c, ['editor.foreground']) ?? theme.fg)

  const accent =
    firstPresent(c, ['textLink.foreground', 'editorLink.activeForeground', 'terminal.ansiBlue']) ??
    fg
  const accentAlt = firstPresent(c, ['terminal.ansiMagenta', 'terminal.ansiCyan']) ?? accent
  const warning =
    firstPresent(c, ['editorWarning.foreground', 'terminal.ansiYellow']) ?? FALLBACK_WARNING
  const danger = firstPresent(c, ['editorError.foreground', 'terminal.ansiRed']) ?? FALLBACK_DANGER
  const success =
    firstPresent(c, ['terminal.ansiGreen', 'gitDecoration.addedResourceForeground']) ??
    FALLBACK_SUCCESS

  const panel =
    firstPresent(c, ['sideBar.background', 'editorGroupHeader.tabsBackground']) ?? shade(bg, -0.04)
  const panelMuted = firstPresent(c, ['sideBarSectionHeader.background']) ?? shade(bg, -0.02)
  const panelHighlight =
    firstPresent(c, ['list.activeSelectionBackground', 'editor.selectionBackground']) ??
    shade(bg, 0.1)
  const overlay =
    firstPresent(c, ['editorWidget.background', 'titleBar.activeBackground']) ?? shade(bg, -0.08)
  const border = firstPresent(c, ['editorGroup.border', 'panel.border']) ?? shade(bg, 0.15)
  const borderActive = firstPresent(c, ['focusBorder']) ?? accent
  const textMuted =
    firstPresent(c, ['descriptionForeground', 'editorLineNumber.foreground']) ?? mix(fg, bg, 0.55)
  const dim = firstPresent(c, ['editor.lineHighlightBackground']) ?? shade(bg, 0.03)

  // diffEditor.*Background values in VSCode themes are typically semi-transparent;
  // stripping alpha produces an unreadably bright color. Always derive by blending.
  const diffAddBg = mix(bg, success, 0.18)
  const diffRemoveBg = mix(bg, danger, 0.18)

  return {
    accent,
    accentAlt,
    background: bg,
    border,
    borderActive,
    danger,
    diffAddBg,
    diffRemoveBg,
    dim,
    overlay,
    panel,
    panelHighlight,
    panelMuted,
    success,
    text: fg,
    textMuted,
    warning,
  }
}

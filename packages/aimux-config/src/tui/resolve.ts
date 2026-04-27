// Port of opencode TUI's resolveTheme + ansiToRgba.
// Source: opencode/packages/opencode/src/cli/cmd/tui/context/theme.tsx:198-301
// (pinned reference). Behavior preserved verbatim; output uses CSS-style color
// strings (hex / rgba) so values flow directly into opentui without conversion.

import type { ResolvedTuiTheme, RGBA, ThemeMode, TuiColorValue, TuiThemeJson } from './types'

import { TUI_COLOR_TOKENS, type TuiColorToken } from './tokens'

const TRANSPARENT: RGBA = { a: 0, b: 0, g: 0, r: 0 }

function rgbaFromHex(hex: string): RGBA {
  const h = hex.replace('#', '')
  // expand short forms (#rgb, #rgba)
  const expanded =
    h.length === 3 || h.length === 4
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h
  if (expanded.length === 6) {
    const num = parseInt(expanded, 16)
    return {
      a: 255,
      b: num & 0xff,
      g: (num >> 8) & 0xff,
      r: (num >> 16) & 0xff,
    }
  }
  if (expanded.length === 8) {
    const num = parseInt(expanded, 16) >>> 0
    return {
      a: num & 0xff,
      b: (num >> 8) & 0xff,
      g: (num >> 16) & 0xff,
      r: (num >> 24) & 0xff,
    }
  }
  return { a: 255, b: 0, g: 0, r: 0 }
}

function ansiToRgba(code: number): RGBA {
  if (code < 16) {
    const ansiColors = [
      '#000000', // Black
      '#800000', // Red
      '#008000', // Green
      '#808000', // Yellow
      '#000080', // Blue
      '#800080', // Magenta
      '#008080', // Cyan
      '#c0c0c0', // White
      '#808080', // Bright Black
      '#ff0000', // Bright Red
      '#00ff00', // Bright Green
      '#ffff00', // Bright Yellow
      '#0000ff', // Bright Blue
      '#ff00ff', // Bright Magenta
      '#00ffff', // Bright Cyan
      '#ffffff', // Bright White
    ]
    return rgbaFromHex(ansiColors[code] ?? '#000000')
  }
  if (code < 232) {
    const index = code - 16
    const b = index % 6
    const g = Math.floor(index / 6) % 6
    const r = Math.floor(index / 36)
    const val = (x: number) => (x === 0 ? 0 : x * 40 + 55)
    return { a: 255, b: val(b), g: val(g), r: val(r) }
  }
  if (code < 256) {
    const gray = (code - 232) * 10 + 8
    return { a: 255, b: gray, g: gray, r: gray }
  }
  return { a: 255, b: 0, g: 0, r: 0 }
}

/** Recursive color resolver. Mirrors opencode TUI `resolveColor`. */
function resolveColorRgba(
  c: TuiColorValue,
  theme: TuiThemeJson,
  mode: ThemeMode,
  chain: string[] = []
): RGBA {
  if (typeof c === 'string') {
    if (c === 'transparent' || c === 'none') return TRANSPARENT
    if (c.startsWith('#')) return rgbaFromHex(c)
    if (chain.includes(c)) {
      throw new Error(`Circular color reference: ${[...chain, c].join(' -> ')}`)
    }
    const defs = theme.defs ?? {}
    const next = defs[c] ?? (theme.theme as Record<string, TuiColorValue>)[c]
    if (next === undefined) {
      throw new Error(`Color reference "${c}" not found in defs or theme`)
    }
    return resolveColorRgba(next, theme, mode, [...chain, c])
  }
  if (typeof c === 'number') return ansiToRgba(c)
  return resolveColorRgba(c[mode], theme, mode, chain)
}

function rgbaToCss(c: RGBA): string {
  const r = Math.max(0, Math.min(255, Math.round(c.r)))
  const g = Math.max(0, Math.min(255, Math.round(c.g)))
  const b = Math.max(0, Math.min(255, Math.round(c.b)))
  const a = Math.max(0, Math.min(255, Math.round(c.a)))
  if (a === 255) {
    const hex = (v: number) => v.toString(16).padStart(2, '0')
    return `#${hex(r)}${hex(g)}${hex(b)}`
  }
  return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`
}

/**
 * Resolve a TUI theme JSON to a flat record of CSS color strings.
 * @param mode "dark" or "light" — selects between {dark, light} branches in token values.
 */
export function resolveTuiTheme(theme: TuiThemeJson, mode: ThemeMode): ResolvedTuiTheme {
  const out: Partial<Record<TuiColorToken, string>> = {}

  // Pass 1: every token defined in the JSON, except optional/derived ones.
  for (const [key, value] of Object.entries(theme.theme)) {
    if (key === 'selectedListItemText' || key === 'backgroundMenu' || key === 'thinkingOpacity')
      continue
    out[key as TuiColorToken] = rgbaToCss(resolveColorRgba(value as TuiColorValue, theme, mode))
  }

  // Pass 2: fallbacks (matches opencode behavior).
  if (theme.theme.selectedListItemText !== undefined) {
    out.selectedListItemText = rgbaToCss(
      resolveColorRgba(theme.theme.selectedListItemText, theme, mode)
    )
  } else if (out.background !== undefined) {
    out.selectedListItemText = out.background
  }

  if (theme.theme.backgroundMenu !== undefined) {
    out.backgroundMenu = rgbaToCss(resolveColorRgba(theme.theme.backgroundMenu, theme, mode))
  } else if (out.backgroundElement !== undefined) {
    out.backgroundMenu = out.backgroundElement
  }

  // Sanity: every token should be present. Any missing token in a JSON falls
  // back to text (foreground) so we never hand an `undefined` to opentui.
  const fallback = out.text ?? out.background ?? '#000000'
  for (const tok of TUI_COLOR_TOKENS) {
    if (out[tok] === undefined) out[tok] = fallback
  }

  return {
    ...(out as Record<TuiColorToken, string>),
    thinkingOpacity: theme.theme.thinkingOpacity ?? 0.6,
  }
}

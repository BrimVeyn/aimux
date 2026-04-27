import type { TuiColorToken } from './tokens'

export type ThemeMode = 'dark' | 'light'

/** RGBA in 0..255 (alpha 0..255, where 255 == opaque). */
export interface RGBA {
  r: number
  g: number
  b: number
  a: number
}

/** A single color value as it appears in a TUI theme JSON. */
export type TuiColorValue =
  | string // hex (#rgb, #rrggbb, #rrggbbaa), ref to defs/token, "transparent", "none"
  | number // ANSI color code 0..255
  | { dark: TuiColorValue; light: TuiColorValue }

export interface TuiThemeJson {
  $schema?: string
  defs?: Record<string, TuiColorValue>
  theme: Partial<Record<TuiColorToken, TuiColorValue>> & {
    thinkingOpacity?: number
  }
}

/** Resolved theme: every color token → CSS-style color string consumable by opentui. */
export type ResolvedTuiTheme = Record<TuiColorToken, string> & {
  thinkingOpacity: number
}

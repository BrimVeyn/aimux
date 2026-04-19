import type { AimuxPalette } from './types'

function stripAlpha(hex: string): string {
  if (hex.length === 9) return hex.slice(0, 7)
  if (hex.length === 5) return hex.slice(0, 4)
  return hex
}

function expand3(hex: string): string {
  if (hex.length === 4) return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
  return hex
}

function parseHex(hex: string): { b: number; g: number; r: number } {
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

/** Linearly mix two hex colors. `t=0` returns `a`, `t=1` returns `b`. */
export function mix(a: string, b: string, t: number): string {
  const ca = parseHex(a)
  const cb = parseHex(b)
  return toHex({
    b: ca.b + (cb.b - ca.b) * t,
    g: ca.g + (cb.g - ca.g) * t,
    r: ca.r + (cb.r - ca.r) * t,
  })
}

/** Muted foreground — half-way between background and ink. */
export function muted(p: AimuxPalette): string {
  return mix(p.neutral, p.ink, 0.55)
}

/** Slightly recessed foreground for line numbers / placeholders. */
export function faint(p: AimuxPalette): string {
  return mix(p.neutral, p.ink, 0.3)
}

/** A surface tone above the base background — sidebars, headers. */
export function elevated(p: AimuxPalette): string {
  return mix(p.neutral, p.ink, 0.04)
}

/** Hover/highlight surface (line highlight, list hover). */
export function hover(p: AimuxPalette): string {
  return mix(p.neutral, p.ink, 0.08)
}

/** Selected/active row surface. Falls back to a primary-tinted shade. */
export function selected(p: AimuxPalette): string {
  return p.interactive ?? mix(p.neutral, p.primary, 0.18)
}

/** Subtle border between panels. */
export function border(p: AimuxPalette): string {
  return mix(p.neutral, p.ink, 0.18)
}

/** Background tint for inserted diff lines. */
export function diffAddBg(p: AimuxPalette): string {
  return p.diffAdd ?? mix(p.neutral, p.success, 0.18)
}

/** Background tint for removed diff lines. */
export function diffDeleteBg(p: AimuxPalette): string {
  return p.diffDelete ?? mix(p.neutral, p.error, 0.18)
}

/** Resolve `accent`, falling back to `primary`. */
export function accent(p: AimuxPalette): string {
  return p.accent ?? p.primary
}

/** Merge a partial palette onto a base palette. */
export function extendPalette(
  base: AimuxPalette,
  overrides: Partial<AimuxPalette> | undefined
): AimuxPalette {
  if (!overrides) return base
  return { ...base, ...overrides }
}

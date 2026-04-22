// Port (minimal) of sst/opencode's generateNeutralScale + generateNeutralAlphaScale
// from packages/ui/src/theme/resolve.ts. Only the `ink`-provided branch of
// generateNeutralScale is needed — every aimux theme supplies an `ink` seed.

import { blend, hexToOklch, mixColors, oklchToHex } from './oklch'

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

export type NeutralScale = readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
]

function pickDarkBg(base: { c: number; h: number; l: number }): string {
  const tone = clamp(0.19 + Math.max(0, base.l - 0.12) * 0.33 + base.c * 1.95, 0.17, 0.27)
  return oklchToHex({
    c: base.c * Math.max(0, 1 - tone * 0.12),
    h: base.h,
    l: base.l * (1 - tone),
  })
}

function pickLightBg(base: { c: number; h: number; l: number }): string {
  const tone =
    base.l < 0.82 ? 0.86 : clamp(0.1 + base.c * 3.2 + Math.max(0, 0.95 - base.l) * 0.35, 0.1, 0.28)
  return oklchToHex({
    c: base.c * Math.max(0, 1 - tone),
    h: base.h,
    l: base.l + (1 - base.l) * tone,
  })
}

/**
 * Produce a 12-step neutral scale from a palette seed.
 *
 * Step 0 is the effective app background (`palette.neutral` is treated as a
 * seed, not a direct hex). Step 11 lands close to `ink`. Intermediate steps
 * mix the computed bg toward ink using opencode's fixed lightness stops.
 */
export function generateNeutralScale(seed: string, isDark: boolean, ink: string): NeutralScale {
  const base = hexToOklch(seed)
  const bg = isDark ? pickDarkBg(base) : pickLightBg(base)

  const steps = isDark
    ? [0, 0.018, 0.039, 0.064, 0.097, 0.143, 0.212, 0.31, 0.46, 0.649, 0.845, 0.984]
    : [0, 0.022, 0.042, 0.068, 0.102, 0.146, 0.208, 0.296, 0.432, 0.61, 0.81, 0.965]

  return steps.map((step) => mixColors(bg, ink, step)) as unknown as NeutralScale
}

/**
 * 12-step alpha overlay scale blending ink → bg. Used for surface-base /
 * surface-hover / border-base tokens so they stay consistent with the
 * computed bg above.
 */
export function generateNeutralAlphaScale(neutral: NeutralScale, isDark: boolean): NeutralScale {
  const alphas = isDark
    ? [0.038, 0.066, 0.1, 0.142, 0.19, 0.252, 0.334, 0.446, 0.58, 0.718, 0.854, 0.985]
    : [0.03, 0.06, 0.1, 0.145, 0.2, 0.265, 0.35, 0.47, 0.61, 0.74, 0.86, 0.97]
  const ink = neutral[11]
  const bg = neutral[0]
  return alphas.map((alpha) => blend(ink, bg, alpha)) as unknown as NeutralScale
}

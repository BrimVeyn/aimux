/* eslint-disable typescript/no-non-null-assertion, no-nested-ternary */
// Port of sst/opencode's `resolveThemeVariant` pipeline (pinned: ff748b82ca55,
// packages/ui/src/theme/resolve.ts). Verbatim except for the `avatar-*` block
// which aimux does not render. Lint rules above are disabled to preserve a
// 1:1 line correspondence with upstream — replacing the array `[i]!` indexing
// or flattening the nested ternaries would make future re-ports painful.
//
// Produces ~236 ResolvedTokens from a palette/seeds variant + isDark flag,
// applying upstream `overrides` as a final flat-merge with three derived
// back-fills (text-weaker, markdown-text/code-block, text-stronger).

import type { ResolvedToken, ResolvedTokens } from './resolved-tokens'
import type { AimuxPalette, ThemeMode } from './types'

import { blend, generateScale, hexToOklch, hexToRgb, oklchToHex, shift, withAlpha } from './oklch'

export interface ThemeSeedColors {
  neutral: string
  primary: string
  success: string
  warning: string
  error: string
  info: string
  interactive: string
  diffAdd: string
  diffDelete: string
}

export type ThemeVariantOverrides = Partial<Record<ResolvedToken, string>>

export type ThemeVariant =
  | { seeds: ThemeSeedColors; palette?: never; overrides?: ThemeVariantOverrides }
  | { palette: AimuxPalette; seeds?: never; overrides?: ThemeVariantOverrides }

interface ThemeColors {
  compact: boolean
  neutral: string
  ink?: string
  primary: string
  accent: string
  success: string
  warning: string
  error: string
  info: string
  interactive: string
  diffAdd?: string
  diffDelete?: string
}

function getColors(variant: ThemeVariant): ThemeColors {
  if (variant.palette && variant.seeds) {
    throw new Error('Theme variant cannot define both `palette` and `seeds`')
  }

  if (variant.palette) {
    const p = variant.palette
    return {
      accent: p.accent ?? p.info,
      compact: true,
      diffAdd: p.diffAdd,
      diffDelete: p.diffDelete,
      error: p.error,
      info: p.info,
      ink: p.ink,
      interactive: p.interactive ?? p.primary,
      neutral: p.neutral,
      primary: p.primary,
      success: p.success,
      warning: p.warning,
    }
  }

  if (variant.seeds) {
    const s = variant.seeds
    return {
      accent: s.info,
      compact: false,
      diffAdd: s.diffAdd,
      diffDelete: s.diffDelete,
      error: s.error,
      info: s.info,
      ink: undefined,
      interactive: s.interactive,
      neutral: s.neutral,
      primary: s.primary,
      success: s.success,
      warning: s.warning,
    }
  }

  throw new Error('Theme variant requires `palette` or `seeds`')
}

function generateNeutralScale(seed: string, isDark: boolean, ink?: string): string[] {
  if (ink) {
    const base = hexToOklch(seed)
    const lift = (tone: number): string =>
      oklchToHex({
        c: base.c * Math.max(0, 1 - tone),
        h: base.h,
        l: base.l + (1 - base.l) * tone,
      })
    const sink = (tone: number): string =>
      oklchToHex({
        c: base.c * Math.max(0, 1 - tone * (isDark ? 0.12 : 0.3)),
        h: base.h,
        l: base.l * (1 - tone),
      })
    const bg = isDark
      ? sink(clamp(0.19 + Math.max(0, base.l - 0.12) * 0.33 + base.c * 1.95, 0.17, 0.27))
      : base.l < 0.82
        ? lift(0.86)
        : lift(clamp(0.1 + base.c * 3.2 + Math.max(0, 0.95 - base.l) * 0.35, 0.1, 0.28))
    const steps = isDark
      ? [0, 0.018, 0.039, 0.064, 0.097, 0.143, 0.212, 0.31, 0.46, 0.649, 0.845, 0.984]
      : [0, 0.022, 0.042, 0.068, 0.102, 0.146, 0.208, 0.296, 0.432, 0.61, 0.81, 0.965]
    return steps.map((step) => mixOklch(bg, ink, step))
  }

  const base = hexToOklch(seed)
  const scale: string[] = []
  const neutralChroma = Math.min(base.c, isDark ? 0.068 : 0.04)
  const lightSteps = isDark
    ? [
        0.138,
        0.156,
        0.178,
        0.202,
        0.232,
        0.272,
        0.326,
        0.404,
        clamp(base.l * 0.83, 0.43, 0.55),
        0.596,
        0.719,
        0.956,
      ]
    : [0.991, 0.979, 0.964, 0.946, 0.931, 0.913, 0.891, 0.83, base.l, 0.617, 0.542, 0.205]
  for (let i = 0; i < 12; i++) {
    scale.push(oklchToHex({ c: neutralChroma, h: base.h, l: lightSteps[i] ?? 0 }))
  }
  return scale
}

function generateNeutralAlphaScale(neutralScale: string[], isDark: boolean): string[] {
  const alphas = isDark
    ? [0.038, 0.066, 0.1, 0.142, 0.19, 0.252, 0.334, 0.446, 0.58, 0.718, 0.854, 0.985]
    : [0.03, 0.06, 0.1, 0.145, 0.2, 0.265, 0.35, 0.47, 0.61, 0.74, 0.86, 0.97]
  return alphas.map((alpha) => blend(neutralScale[11]!, neutralScale[0]!, alpha))
}

function getHex(value: string | undefined): string | undefined {
  if (!value || !value.startsWith('#')) return undefined
  return value
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function mixOklch(a: string, b: string, t: number): string {
  const ca = hexToOklch(a)
  const cb = hexToOklch(b)
  const delta = ((((cb.h - ca.h) % 360) + 540) % 360) - 180
  return oklchToHex({
    c: ca.c + (cb.c - ca.c) * t,
    h: ca.h + delta * t,
    l: ca.l + (cb.l - ca.l) * t,
  })
}

export function resolveThemeVariant(variant: ThemeVariant, isDark: boolean): ResolvedTokens {
  const colors = getColors(variant)
  const { overrides = {} } = variant

  const neutral = generateNeutralScale(colors.neutral, isDark, colors.ink)
  const primary = generateScale(colors.primary, isDark)
  const accent = generateScale(colors.accent, isDark)
  const success = generateScale(colors.success, isDark)
  const warning = generateScale(colors.warning, isDark)
  const error = generateScale(colors.error, isDark)
  const info = generateScale(colors.info, isDark)
  const interactive = generateScale(colors.interactive, isDark)
  const amber = generateScale(
    shift(colors.warning, isDark ? { c: 1.14, h: -16, l: -0.058 } : { c: 0.94, h: -22, l: -0.082 }),
    isDark
  )
  const blue = generateScale(shift(colors.interactive, { c: 1.12, h: -12, l: 0.128 }), isDark)
  const diffAdd = generateScale(
    colors.diffAdd ?? shift(colors.success, { c: isDark ? 0.7 : 0.55, l: isDark ? -0.18 : 0.14 }),
    isDark
  )
  const diffDelete = generateScale(
    colors.diffDelete ?? shift(colors.error, { c: isDark ? 0.82 : 0.7, l: isDark ? -0.08 : 0.08 }),
    isDark
  )
  const ink = colors.ink ?? colors.neutral
  const tint = colors.compact ? hexToOklch(ink) : undefined
  const body = tint
    ? shift(ink, {
        c: isDark ? 1.04 : 1.02,
        l: isDark ? Math.max(0, 0.88 - tint.l) * 0.4 : -Math.max(0, tint.l - 0.18) * 0.24,
      })
    : undefined

  const backgroundOverride = overrides['background-base']
  const backgroundHex = getHex(backgroundOverride)
  const overlay = Boolean(backgroundOverride) && !backgroundHex
  const background = backgroundHex ?? neutral[0]!
  const alphaTone = (color: string, alpha: number): string =>
    overlay ? withAlpha(color, alpha) : blend(color, background, alpha)

  const content = (seed: string, scale: string[]): string => {
    const base = hexToOklch(seed)
    const value = isDark ? (base.l > 0.84 ? shift(seed, { c: 1.18 }) : scale[10]!) : scale[10]!
    return shift(value, { c: isDark ? 1.3 : 1.18, l: isDark ? 0.034 : -0.024 })
  }
  const modified = (): string => {
    if (!colors.compact) return isDark ? '#ffba92' : '#FF8C00'
    const warningHue = hexToOklch(colors.warning).h
    const deleteHue = hexToOklch(colors.diffDelete ?? colors.error).h
    const delta = Math.abs(((((deleteHue - warningHue) % 360) + 540) % 360) - 180)
    if (delta < 48) return isDark ? '#ffba92' : '#FF8C00'
    return content(colors.warning, warning)
  }
  const surface = (
    seed: string,
    alpha: { base: number; weak: number; weaker: number; strong: number; stronger: number }
  ): { base: string; weak: string; weaker: string; strong: string; stronger: string } => ({
    base: alphaTone(seed, alpha.base),
    strong: alphaTone(seed, alpha.strong),
    stronger: alphaTone(seed, alpha.stronger),
    weak: alphaTone(seed, alpha.weak),
    weaker: alphaTone(seed, alpha.weaker),
  })
  const borderTone = (light: number, dark: number): string =>
    alphaTone(
      ink,
      isDark ? Math.min(1, dark + 0.024 + (colors.compact ? 0.08 : 0)) : Math.min(1, light + 0.024)
    )
  const diffHiddenSurface = surface(
    isDark
      ? shift(colors.interactive, { c: 0.55, l: 0 })
      : shift(colors.interactive, { c: 0.45, l: 0.08 }),
    isDark
      ? { base: 0.14, strong: 0.26, stronger: 0.42, weak: 0.08, weaker: 0.18 }
      : { base: 0.12, strong: 0.24, stronger: 0.36, weak: 0.08, weaker: 0.16 }
  )

  const neutralAlpha = generateNeutralAlphaScale(neutral, isDark)
  const brandb = primary[8]!
  const brandh = primary[9]!
  const interb = interactive[isDark ? 6 : 4]!
  const interh = interactive[isDark ? 7 : 5]!
  const interw = interactive[isDark ? 5 : 3]!
  const succb = success[isDark ? 6 : 4]!
  const succw = success[isDark ? 5 : 3]!
  const succs = success[10]!
  const warnb = warning[isDark ? 6 : 4]!
  const warnw = warning[isDark ? 5 : 3]!
  const warns = warning[10]!
  const critb = error[isDark ? 6 : 4]!
  const critw = error[isDark ? 5 : 3]!
  const crits = error[10]!
  const infob = info[isDark ? 6 : 4]!
  const infow = info[isDark ? 5 : 3]!
  const infos = info[10]!
  const lum = (hex: string): number => {
    const rgb = hexToRgb(hex)
    const lift = (v: number): number =>
      v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    return 0.2126 * lift(rgb.r) + 0.7152 * lift(rgb.g) + 0.0722 * lift(rgb.b)
  }
  const hit = (a: string, b: string): number => {
    const x = lum(a)
    const y = lum(b)
    const light = Math.max(x, y)
    const dark = Math.min(x, y)
    return (light + 0.05) / (dark + 0.05)
  }
  const on = (fill: string): string => {
    const light = '#ffffff'
    const dark = '#000000'
    return hit(light, fill) > hit(dark, fill) ? light : dark
  }

  const tokens = {} as ResolvedTokens

  tokens['background-base'] = neutral[0]!
  tokens['background-weak'] = neutral[2]!
  tokens['background-strong'] = neutral[0]!
  tokens['background-stronger'] = isDark ? neutral[1]! : '#fcfcfc'

  tokens['surface-base'] = neutralAlpha[1]!
  tokens['base'] = neutralAlpha[1]!
  tokens['surface-base-hover'] = neutralAlpha[2]!
  tokens['surface-base-active'] = neutralAlpha[2]!
  tokens['surface-base-interactive-active'] = withAlpha(interactive[2]!, 0.3)
  tokens['base2'] = neutralAlpha[1]!
  tokens['base3'] = neutralAlpha[1]!
  tokens['surface-inset-base'] = neutralAlpha[1]!
  tokens['surface-inset-base-hover'] = neutralAlpha[2]!
  tokens['surface-inset-strong'] = isDark
    ? withAlpha(neutral[0]!, 0.5)
    : withAlpha(neutral[3]!, 0.09)
  tokens['surface-inset-strong-hover'] = tokens['surface-inset-strong']
  tokens['surface-raised-base'] = neutralAlpha[0]!
  tokens['surface-float-base'] = isDark ? neutral[1]! : neutral[11]!
  tokens['surface-float-base-hover'] = isDark ? neutral[2]! : neutral[10]!
  tokens['surface-raised-base-hover'] = neutralAlpha[1]!
  tokens['surface-raised-base-active'] = neutralAlpha[2]!
  tokens['surface-raised-strong'] = isDark ? neutralAlpha[3]! : neutral[0]!
  tokens['surface-raised-strong-hover'] = isDark ? neutralAlpha[5]! : '#ffffff'
  tokens['surface-raised-stronger'] = isDark ? neutralAlpha[5]! : '#ffffff'
  tokens['surface-raised-stronger-hover'] = isDark ? neutralAlpha[6]! : '#ffffff'
  tokens['surface-weak'] = neutralAlpha[2]!
  tokens['surface-weaker'] = neutralAlpha[3]!
  tokens['surface-strong'] = isDark ? neutralAlpha[6]! : '#ffffff'
  tokens['surface-raised-stronger-non-alpha'] = isDark ? neutral[2]! : '#ffffff'

  tokens['surface-brand-base'] = brandb
  tokens['surface-brand-hover'] = brandh

  tokens['surface-interactive-base'] = interb
  tokens['surface-interactive-hover'] = interh
  tokens['surface-interactive-weak'] = interw
  tokens['surface-interactive-weak-hover'] = interb

  tokens['surface-success-base'] = succb
  tokens['surface-success-weak'] = succw
  tokens['surface-success-strong'] = succs
  tokens['surface-warning-base'] = warnb
  tokens['surface-warning-weak'] = warnw
  tokens['surface-warning-strong'] = warns
  tokens['surface-critical-base'] = critb
  tokens['surface-critical-weak'] = critw
  tokens['surface-critical-strong'] = crits
  tokens['surface-info-base'] = infob
  tokens['surface-info-weak'] = infow
  tokens['surface-info-strong'] = infos

  tokens['surface-diff-unchanged-base'] = isDark ? neutral[0]! : '#ffffff00'
  tokens['surface-diff-skip-base'] = isDark ? neutralAlpha[0]! : neutral[1]!
  tokens['surface-diff-hidden-base'] = diffHiddenSurface.base
  tokens['surface-diff-hidden-weak'] = diffHiddenSurface.weak
  tokens['surface-diff-hidden-weaker'] = diffHiddenSurface.weaker
  tokens['surface-diff-hidden-strong'] = diffHiddenSurface.strong
  tokens['surface-diff-hidden-stronger'] = diffHiddenSurface.stronger
  tokens['surface-diff-add-base'] = diffAdd[2]!
  tokens['surface-diff-add-weak'] = diffAdd[isDark ? 3 : 1]!
  tokens['surface-diff-add-weaker'] = diffAdd[isDark ? 2 : 0]!
  tokens['surface-diff-add-strong'] = diffAdd[4]!
  tokens['surface-diff-add-stronger'] = diffAdd[isDark ? 10 : 8]!
  tokens['surface-diff-delete-base'] = diffDelete[2]!
  tokens['surface-diff-delete-weak'] = diffDelete[isDark ? 3 : 1]!
  tokens['surface-diff-delete-weaker'] = diffDelete[isDark ? 2 : 0]!
  tokens['surface-diff-delete-strong'] = diffDelete[isDark ? 4 : 5]!
  tokens['surface-diff-delete-stronger'] = diffDelete[isDark ? 10 : 8]!

  tokens['input-base'] = isDark ? neutral[1]! : neutral[0]!
  tokens['input-hover'] = isDark ? neutral[2]! : neutral[1]!
  tokens['input-active'] = isDark ? interactive[6]! : interactive[0]!
  tokens['input-selected'] = isDark ? interactive[7]! : interactive[3]!
  tokens['input-focus'] = isDark ? interactive[6]! : interactive[0]!
  tokens['input-disabled'] = neutral[3]!

  tokens['text-base'] = colors.compact ? body! : neutral[10]!
  tokens['text-weak'] = colors.compact
    ? shift(body!, { c: 0.9, l: isDark ? -0.11 : 0.11 })
    : neutral[8]!
  tokens['text-weaker'] = colors.compact
    ? shift(body!, { c: isDark ? 0.78 : 0.72, l: isDark ? -0.2 : 0.21 })
    : neutral[7]!
  tokens['text-strong'] = colors.compact
    ? isDark
      ? blend('#ffffff', body!, 0.9)
      : shift(body!, { c: 1.04, l: -0.07 })
    : neutral[11]!
  tokens['text-invert-base'] = isDark ? neutral[10]! : neutral[1]!
  tokens['text-invert-weak'] = isDark ? neutral[8]! : neutral[2]!
  tokens['text-invert-weaker'] = isDark ? neutral[7]! : neutral[3]!
  tokens['text-invert-strong'] = isDark ? neutral[11]! : neutral[0]!
  tokens['text-interactive-base'] = interactive[isDark ? 10 : 9]!
  tokens['text-on-brand-base'] = on(brandb)
  tokens['text-on-interactive-base'] = on(interb)
  tokens['text-on-interactive-weak'] = on(interb)
  tokens['text-on-success-base'] = on(succb)
  tokens['text-on-critical-base'] = on(critb)
  tokens['text-on-critical-weak'] = on(critb)
  tokens['text-on-critical-strong'] = on(crits)
  tokens['text-on-warning-base'] = on(warnb)
  tokens['text-on-info-base'] = on(infob)
  tokens['text-diff-add-base'] = diffAdd[10]!
  tokens['text-diff-delete-base'] = diffDelete[9]!
  tokens['text-diff-delete-strong'] = diffDelete[11]!
  tokens['text-diff-add-strong'] = diffAdd[isDark ? 7 : 11]!
  tokens['text-on-info-weak'] = on(infob)
  tokens['text-on-info-strong'] = on(infos)
  tokens['text-on-warning-weak'] = on(warnb)
  tokens['text-on-warning-strong'] = on(warns)
  tokens['text-on-success-weak'] = on(succb)
  tokens['text-on-success-strong'] = on(succs)
  tokens['text-on-brand-weak'] = on(brandb)
  tokens['text-on-brand-weaker'] = on(brandb)
  tokens['text-on-brand-strong'] = on(brandh)

  tokens['button-primary-base'] = neutral[11]!
  tokens['button-secondary-base'] = isDark ? neutral[2]! : neutral[0]!
  tokens['button-secondary-hover'] = isDark ? neutral[3]! : neutral[1]!
  tokens['button-ghost-hover'] = neutralAlpha[1]!
  tokens['button-ghost-hover2'] = neutralAlpha[2]!

  tokens['border-base'] = colors.compact ? borderTone(0.22, 0.16) : neutralAlpha[6]!
  tokens['border-hover'] = colors.compact ? borderTone(0.28, 0.2) : neutralAlpha[7]!
  tokens['border-active'] = colors.compact ? borderTone(0.34, 0.24) : neutralAlpha[8]!
  tokens['border-selected'] = withAlpha(interactive[8]!, isDark ? 0.9 : 0.99)
  tokens['border-disabled'] = colors.compact ? borderTone(0.18, 0.12) : neutralAlpha[7]!
  tokens['border-focus'] = colors.compact ? borderTone(0.34, 0.24) : neutralAlpha[8]!
  tokens['border-weak-base'] = colors.compact
    ? borderTone(0.1, 0.08)
    : neutralAlpha[isDark ? 5 : 4]!
  tokens['border-strong-base'] = colors.compact
    ? borderTone(0.34, 0.24)
    : neutralAlpha[isDark ? 7 : 6]!
  tokens['border-strong-hover'] = colors.compact ? borderTone(0.4, 0.28) : neutralAlpha[7]!
  tokens['border-strong-active'] = colors.compact
    ? borderTone(0.46, 0.32)
    : neutralAlpha[isDark ? 7 : 6]!
  tokens['border-strong-selected'] = withAlpha(interactive[5]!, 0.6)
  tokens['border-strong-disabled'] = colors.compact ? borderTone(0.14, 0.1) : neutralAlpha[5]!
  tokens['border-strong-focus'] = colors.compact
    ? borderTone(0.46, 0.32)
    : neutralAlpha[isDark ? 7 : 6]!
  tokens['border-weak-hover'] = colors.compact
    ? borderTone(0.16, 0.12)
    : neutralAlpha[isDark ? 6 : 5]!
  tokens['border-weak-active'] = colors.compact
    ? borderTone(0.22, 0.16)
    : neutralAlpha[isDark ? 7 : 6]!
  tokens['border-weak-selected'] = withAlpha(interactive[4]!, isDark ? 0.6 : 0.5)
  tokens['border-weak-disabled'] = colors.compact ? borderTone(0.08, 0.06) : neutralAlpha[5]!
  tokens['border-weak-focus'] = colors.compact
    ? borderTone(0.22, 0.16)
    : neutralAlpha[isDark ? 7 : 6]!
  tokens['border-weaker-base'] = colors.compact ? borderTone(0.06, 0.04) : neutralAlpha[2]!

  tokens['border-interactive-base'] = interactive[6]!
  tokens['border-interactive-hover'] = interactive[7]!
  tokens['border-interactive-active'] = interactive[8]!
  tokens['border-interactive-selected'] = interactive[8]!
  tokens['border-interactive-disabled'] = neutral[7]!
  tokens['border-interactive-focus'] = interactive[8]!

  tokens['border-success-base'] = success[6]!
  tokens['border-success-hover'] = success[7]!
  tokens['border-success-selected'] = success[8]!
  tokens['border-warning-base'] = warning[6]!
  tokens['border-warning-hover'] = warning[7]!
  tokens['border-warning-selected'] = warning[8]!
  tokens['border-critical-base'] = error[6]!
  tokens['border-critical-hover'] = error[7]!
  tokens['border-critical-selected'] = error[8]!
  tokens['border-info-base'] = info[6]!
  tokens['border-info-hover'] = info[7]!
  tokens['border-info-selected'] = info[8]!
  tokens['border-color'] = '#ffffff'

  tokens['icon-base'] = colors.compact && !isDark ? tokens['text-weak'] : neutral[isDark ? 9 : 8]!
  tokens['icon-hover'] = colors.compact && !isDark ? tokens['text-base'] : neutral[10]!
  tokens['icon-active'] = colors.compact && !isDark ? tokens['text-strong'] : neutral[11]!
  tokens['icon-selected'] = colors.compact && !isDark ? tokens['text-strong'] : neutral[11]!
  tokens['icon-disabled'] = neutral[isDark ? 6 : 7]!
  tokens['icon-focus'] = colors.compact && !isDark ? tokens['text-strong'] : neutral[11]!
  tokens['icon-invert-base'] = isDark ? neutral[0]! : '#ffffff'
  tokens['icon-weak-base'] = neutral[isDark ? 5 : 6]!
  tokens['icon-weak-hover'] = neutral[isDark ? 11 : 7]!
  tokens['icon-weak-active'] = neutral[8]!
  tokens['icon-weak-selected'] = neutral[isDark ? 8 : 9]!
  tokens['icon-weak-disabled'] = neutral[isDark ? 3 : 5]!
  tokens['icon-weak-focus'] = neutral[8]!
  tokens['icon-strong-base'] = neutral[11]!
  tokens['icon-strong-hover'] = isDark ? '#f6f3f3' : '#151313'
  tokens['icon-strong-active'] = isDark ? '#fcfcfc' : '#020202'
  tokens['icon-strong-selected'] = isDark ? '#fdfcfc' : '#020202'
  tokens['icon-strong-disabled'] = neutral[7]!
  tokens['icon-strong-focus'] = isDark ? '#fdfcfc' : '#020202'
  tokens['icon-brand-base'] = isDark ? '#ffffff' : neutral[11]!
  tokens['icon-interactive-base'] = interactive[8]!
  tokens['icon-success-base'] = success[isDark ? 8 : 6]!
  tokens['icon-success-hover'] = success[9]!
  tokens['icon-success-active'] = success[10]!
  tokens['icon-warning-base'] = amber[isDark ? 8 : 6]!
  tokens['icon-warning-hover'] = amber[9]!
  tokens['icon-warning-active'] = amber[10]!
  tokens['icon-critical-base'] = error[isDark ? 8 : 9]!
  tokens['icon-critical-hover'] = error[9]!
  tokens['icon-critical-active'] = error[10]!
  tokens['icon-info-base'] = info[isDark ? 8 : 6]!
  tokens['icon-info-hover'] = info[isDark ? 9 : 7]!
  tokens['icon-info-active'] = info[10]!
  tokens['icon-on-brand-base'] = on(brandb)
  tokens['icon-on-brand-hover'] = on(brandh)
  tokens['icon-on-brand-selected'] = on(brandh)
  tokens['icon-on-interactive-base'] = on(interb)

  tokens['icon-agent-plan-base'] = info[8]!
  tokens['icon-agent-docs-base'] = amber[8]!
  tokens['icon-agent-ask-base'] = blue[8]!
  tokens['icon-agent-build-base'] = interactive[isDark ? 10 : 8]!

  tokens['icon-on-success-base'] = on(succb)
  tokens['icon-on-success-hover'] = on(succs)
  tokens['icon-on-success-selected'] = on(succs)
  tokens['icon-on-warning-base'] = on(warnb)
  tokens['icon-on-warning-hover'] = on(warns)
  tokens['icon-on-warning-selected'] = on(warns)
  tokens['icon-on-critical-base'] = on(critb)
  tokens['icon-on-critical-hover'] = on(crits)
  tokens['icon-on-critical-selected'] = on(crits)
  tokens['icon-on-info-base'] = on(infob)
  tokens['icon-on-info-hover'] = on(infos)
  tokens['icon-on-info-selected'] = on(infos)

  tokens['icon-diff-add-base'] = diffAdd[10]!
  tokens['icon-diff-add-hover'] = diffAdd[isDark ? 9 : 11]!
  tokens['icon-diff-add-active'] = diffAdd[isDark ? 10 : 11]!
  tokens['icon-diff-delete-base'] = diffDelete[9]!
  tokens['icon-diff-delete-hover'] = diffDelete[10]!
  tokens['icon-diff-modified-base'] = modified()

  if (colors.compact) {
    tokens['syntax-comment'] = 'var(--text-weak)'
    tokens['syntax-regexp'] = 'var(--text-base)'
    tokens['syntax-string'] = content(colors.success, success)
    tokens['syntax-keyword'] = content(colors.accent, accent)
    tokens['syntax-primitive'] = content(colors.primary, primary)
    tokens['syntax-operator'] = isDark ? 'var(--text-weak)' : 'var(--text-base)'
    tokens['syntax-variable'] = 'var(--text-strong)'
    tokens['syntax-property'] = content(colors.info, info)
    tokens['syntax-type'] = content(colors.warning, warning)
    tokens['syntax-constant'] = content(colors.accent, accent)
    tokens['syntax-punctuation'] = isDark ? 'var(--text-weak)' : 'var(--text-base)'
    tokens['syntax-object'] = 'var(--text-strong)'
    tokens['syntax-success'] = success[10]!
    tokens['syntax-warning'] = amber[10]!
    tokens['syntax-critical'] = error[10]!
    tokens['syntax-info'] = content(colors.info, info)
    tokens['syntax-diff-add'] = diffAdd[10]!
    tokens['syntax-diff-delete'] = diffDelete[10]!
    tokens['syntax-diff-unknown'] = '#ff0000'

    tokens['markdown-heading'] = content(colors.primary, primary)
    tokens['markdown-text'] = tokens['text-base']
    tokens['markdown-link'] = content(colors.interactive, interactive)
    tokens['markdown-link-text'] = content(colors.info, info)
    tokens['markdown-code'] = content(colors.success, success)
    tokens['markdown-block-quote'] = content(colors.warning, warning)
    tokens['markdown-emph'] = content(colors.warning, warning)
    tokens['markdown-strong'] = content(colors.accent, accent)
    tokens['markdown-horizontal-rule'] = tokens['border-base']
    tokens['markdown-list-item'] = content(colors.interactive, interactive)
    tokens['markdown-list-enumeration'] = content(colors.info, info)
    tokens['markdown-image'] = content(colors.interactive, interactive)
    tokens['markdown-image-text'] = content(colors.info, info)
    tokens['markdown-code-block'] = tokens['text-base']
  }

  if (!colors.compact) {
    tokens['syntax-comment'] = 'var(--text-weak)'
    tokens['syntax-regexp'] = 'var(--text-base)'
    tokens['syntax-string'] = isDark ? '#00ceb9' : '#006656'
    tokens['syntax-keyword'] = 'var(--text-weak)'
    tokens['syntax-primitive'] = isDark ? '#ffba92' : '#fb4804'
    tokens['syntax-operator'] = isDark ? 'var(--text-weak)' : 'var(--text-base)'
    tokens['syntax-variable'] = 'var(--text-strong)'
    tokens['syntax-property'] = isDark ? '#ff9ae2' : '#ed6dc8'
    tokens['syntax-type'] = isDark ? '#ecf58c' : '#596600'
    tokens['syntax-constant'] = isDark ? '#93e9f6' : '#007b80'
    tokens['syntax-punctuation'] = isDark ? 'var(--text-weak)' : 'var(--text-base)'
    tokens['syntax-object'] = 'var(--text-strong)'
    tokens['syntax-success'] = success[10]!
    tokens['syntax-warning'] = amber[10]!
    tokens['syntax-critical'] = error[10]!
    tokens['syntax-info'] = isDark ? '#93e9f6' : '#0092a8'
    tokens['syntax-diff-add'] = diffAdd[10]!
    tokens['syntax-diff-delete'] = diffDelete[10]!
    tokens['syntax-diff-unknown'] = '#ff0000'

    tokens['markdown-heading'] = isDark ? '#9d7cd8' : '#d68c27'
    tokens['markdown-text'] = isDark ? '#eeeeee' : '#1a1a1a'
    tokens['markdown-link'] = isDark ? '#fab283' : '#3b7dd8'
    tokens['markdown-link-text'] = isDark ? '#56b6c2' : '#318795'
    tokens['markdown-code'] = isDark ? '#7fd88f' : '#3d9a57'
    tokens['markdown-block-quote'] = isDark ? '#e5c07b' : '#b0851f'
    tokens['markdown-emph'] = isDark ? '#e5c07b' : '#b0851f'
    tokens['markdown-strong'] = isDark ? '#f5a742' : '#d68c27'
    tokens['markdown-horizontal-rule'] = isDark ? '#808080' : '#8a8a8a'
    tokens['markdown-list-item'] = isDark ? '#fab283' : '#3b7dd8'
    tokens['markdown-list-enumeration'] = isDark ? '#56b6c2' : '#318795'
    tokens['markdown-image'] = isDark ? '#fab283' : '#3b7dd8'
    tokens['markdown-image-text'] = isDark ? '#56b6c2' : '#318795'
    tokens['markdown-code-block'] = isDark ? '#eeeeee' : '#1a1a1a'
  }

  // Final pass: upstream-supplied overrides win over computed values.
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      tokens[key as ResolvedToken] = value
    }
  }

  // Derived back-fills (mirror upstream lines 433-453 verbatim).
  if (colors.compact && 'text-weak' in overrides && !('text-weaker' in overrides)) {
    const weak = tokens['text-weak']
    tokens['text-weaker'] = weak.startsWith('#')
      ? shift(weak, { c: 0.75, l: isDark ? -0.12 : 0.12 })
      : weak
  }

  if (colors.compact) {
    if (!('markdown-text' in overrides)) {
      tokens['markdown-text'] = tokens['text-base']
    }
    if (!('markdown-code-block' in overrides)) {
      tokens['markdown-code-block'] = tokens['text-base']
    }
  }

  if (!('text-stronger' in overrides)) {
    tokens['text-stronger'] = tokens['text-strong']
  }

  return tokens
}

/** Convenience: resolve directly from an aimux palette + light/dark mode. */
export function resolveTheme(
  palette: AimuxPalette,
  mode: ThemeMode,
  overrides?: ThemeVariantOverrides
): ResolvedTokens {
  return resolveThemeVariant({ overrides, palette }, mode === 'dark')
}

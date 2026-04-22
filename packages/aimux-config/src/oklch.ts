// OKLCH color helpers. Ported (and trimmed) from sst/opencode:
// packages/ui/src/theme/color.ts — used by neutral-scale.ts to derive
// aimux surface tokens from a palette seed.

export interface OklchColor {
  l: number
  c: number
  h: number
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function hue(v: number): number {
  return ((v % 360) + 360) % 360
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '')
  const full =
    h.length === 3 || h.length === 4
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h
  const rgb = full.length === 8 ? full.slice(0, 6) : full
  const num = parseInt(rgb, 16)
  return {
    b: (num & 255) / 255,
    g: ((num >> 8) & 255) / 255,
    r: ((num >> 16) & 255) / 255,
  }
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number): string => {
    const clamped = clamp(v, 0, 1)
    const int = Math.round(clamped * 255)
    return int.toString(16).padStart(2, '0')
  }
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function srgbToLinear(c: number): number {
  if (c <= 0.04045) return c / 12.92
  return Math.pow((c + 0.055) / 1.055, 2.4)
}

function linearToSrgb(c: number): number {
  if (c <= 0.0031308) return c * 12.92
  return 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

export function rgbToOklch(r: number, g: number, b: number): OklchColor {
  const lr = srgbToLinear(r)
  const lg = srgbToLinear(g)
  const lb = srgbToLinear(b)

  const lLong = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb
  const mLong = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb
  const sLong = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb

  const lCbrt = Math.cbrt(lLong)
  const mCbrt = Math.cbrt(mLong)
  const sCbrt = Math.cbrt(sLong)

  const L = 0.2104542553 * lCbrt + 0.793617785 * mCbrt - 0.0040720468 * sCbrt
  const a = 1.9779984951 * lCbrt - 2.428592205 * mCbrt + 0.4505937099 * sCbrt
  const bOk = 0.0259040371 * lCbrt + 0.7827717662 * mCbrt - 0.808675766 * sCbrt

  const C = Math.sqrt(a * a + bOk * bOk)
  let H = Math.atan2(bOk, a) * (180 / Math.PI)
  if (H < 0) H += 360

  return { c: C, h: H, l: L }
}

export function oklchToRgb(ok: OklchColor): { r: number; g: number; b: number } {
  const { c: C, h: H, l: L } = ok
  const a = C * Math.cos((H * Math.PI) / 180)
  const b = C * Math.sin((H * Math.PI) / 180)

  const lLin = L + 0.3963377774 * a + 0.2158037573 * b
  const mLin = L - 0.1055613458 * a - 0.0638541728 * b
  const sLin = L - 0.0894841775 * a - 1.291485548 * b

  const l3 = lLin * lLin * lLin
  const m3 = mLin * mLin * mLin
  const s3 = sLin * sLin * sLin

  const lr = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3
  const lg = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3
  const lb = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3

  return { b: linearToSrgb(lb), g: linearToSrgb(lg), r: linearToSrgb(lr) }
}

export function hexToOklch(hex: string): OklchColor {
  const { b, g, r } = hexToRgb(hex)
  return rgbToOklch(r, g, b)
}

// Pull an out-of-gamut OKLCH into sRGB by shrinking chroma.
export function fitOklch(ok: OklchColor): OklchColor {
  const base: OklchColor = {
    c: Math.max(0, ok.c),
    h: hue(ok.h),
    l: clamp(ok.l, 0, 1),
  }
  const rgb = oklchToRgb(base)
  if (rgb.r >= 0 && rgb.r <= 1 && rgb.g >= 0 && rgb.g <= 1 && rgb.b >= 0 && rgb.b <= 1) {
    return base
  }
  let c = base.c
  for (let i = 0; i < 24; i++) {
    c *= 0.9
    const next: OklchColor = { ...base, c }
    const out = oklchToRgb(next)
    if (out.r >= 0 && out.r <= 1 && out.g >= 0 && out.g <= 1 && out.b >= 0 && out.b <= 1) {
      return next
    }
  }
  return { ...base, c: 0 }
}

export function oklchToHex(ok: OklchColor): string {
  const { b, g, r } = oklchToRgb(fitOklch(ok))
  return rgbToHex(r, g, b)
}

/** OKLCH-space mix. t=0 returns `a`, t=1 returns `b`. Uses shortest hue arc. */
export function mixColors(a: string, b: string, t: number): string {
  const ca = hexToOklch(a)
  const cb = hexToOklch(b)
  const delta = ((((cb.h - ca.h) % 360) + 540) % 360) - 180
  return oklchToHex({
    c: ca.c + (cb.c - ca.c) * t,
    h: ca.h + delta * t,
    l: ca.l + (cb.l - ca.l) * t,
  })
}

/** OKLCH shift: additive L, multiplicative C, additive H (degrees). */
export function shift(color: string, value: { l?: number; c?: number; h?: number }): string {
  const base = hexToOklch(color)
  return oklchToHex({
    c: base.c * (value.c ?? 1),
    h: base.h + (value.h ?? 0),
    l: base.l + (value.l ?? 0),
  })
}

/** sRGB alpha blend: `color` over `background` at `alpha` opacity. */
export function blend(color: string, background: string, alpha: number): string {
  const fg = hexToRgb(color)
  const bg = hexToRgb(background)
  return rgbToHex(
    fg.r * alpha + bg.r * (1 - alpha),
    fg.g * alpha + bg.g * (1 - alpha),
    fg.b * alpha + bg.b * (1 - alpha)
  )
}

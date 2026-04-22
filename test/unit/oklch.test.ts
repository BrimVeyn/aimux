import { describe, expect, test } from 'bun:test'

import {
  generateNeutralAlphaScale,
  generateNeutralScale,
} from '../../packages/aimux-config/src/neutral-scale'
import {
  blend,
  generateAlphaScale,
  generateScale,
  hexToOklch,
  hexToRgb,
  mixColors,
  oklchToHex,
  rgbToHex,
  shift,
  withAlpha,
} from '../../packages/aimux-config/src/oklch'
import { computeSurfaces } from '../../packages/aimux-config/src/palette-utils'

const CASES: string[] = ['#000000', '#ffffff', '#8e8e8e', '#2e3440', '#fdf6e3', '#393939']

describe('oklch round-trip', () => {
  test('rgb hex round-trip is exact', () => {
    for (const hex of CASES) {
      const { b, g, r } = hexToRgb(hex)
      expect(rgbToHex(r, g, b)).toBe(hex)
    }
  })

  test('oklch round-trip is stable within 1/255 per channel', () => {
    for (const hex of CASES) {
      const round = oklchToHex(hexToOklch(hex))
      const a = hexToRgb(hex)
      const b = hexToRgb(round)
      expect(Math.abs(a.r - b.r)).toBeLessThanOrEqual(1 / 255 + 1e-9)
      expect(Math.abs(a.g - b.g)).toBeLessThanOrEqual(1 / 255 + 1e-9)
      expect(Math.abs(a.b - b.b)).toBeLessThanOrEqual(1 / 255 + 1e-9)
    }
  })
})

describe('mixColors', () => {
  test('t=0 returns first color (within 1/255)', () => {
    const m = mixColors('#2e3440', '#e5e9f0', 0)
    expect(m).toBe('#2e3440')
  })
  test('t=1 returns second color (within 1/255)', () => {
    const m = mixColors('#2e3440', '#e5e9f0', 1)
    expect(m).toBe('#e5e9f0')
  })
  test('t=0.5 lands between the two', () => {
    const m = mixColors('#000000', '#ffffff', 0.5)
    const { b, g, r } = hexToRgb(m)
    expect(r).toBeGreaterThan(0.3)
    expect(r).toBeLessThan(0.7)
    expect(r).toBeCloseTo(g, 2)
    expect(g).toBeCloseTo(b, 2)
  })
})

describe('blend', () => {
  test('alpha=0 yields the background', () => {
    expect(blend('#ff0000', '#ffffff', 0)).toBe('#ffffff')
  })
  test('alpha=1 yields the foreground', () => {
    expect(blend('#ff0000', '#ffffff', 1)).toBe('#ff0000')
  })
})

describe('shift', () => {
  test('empty shift is identity (within 1/255)', () => {
    expect(shift('#8e8e8e', {})).toBe('#8e8e8e')
  })
  test('l: +0.2 lightens', () => {
    const shifted = shift('#393939', { l: 0.2 })
    const base = hexToOklch('#393939')
    const out = hexToOklch(shifted)
    expect(out.l).toBeGreaterThan(base.l + 0.15)
  })
})

describe('generateNeutralScale', () => {
  test('carbonfox-light (#8e8e8e seed) produces a near-white bg', () => {
    const scale = generateNeutralScale('#8e8e8e', false, '#161616')
    expect(scale.length).toBe(12)
    const bg = hexToOklch(scale[0])
    expect(bg.l).toBeGreaterThan(0.9)
    expect(bg.c).toBeLessThan(0.03)
  })

  test('nord-dark (#2e3440 seed) produces a darker bg than the seed', () => {
    const scale = generateNeutralScale('#2e3440', true, '#e5e9f0')
    const seed = hexToOklch('#2e3440')
    const bg = hexToOklch(scale[0])
    expect(bg.l).toBeLessThan(seed.l)
    expect(bg.l).toBeGreaterThan(0.15)
    expect(bg.l).toBeLessThan(0.28)
  })

  test('scale ends ink-dominated (step 11 ≈ ink)', () => {
    const scale = generateNeutralScale('#2e3440', true, '#e5e9f0')
    const top = hexToOklch(scale[11])
    const ink = hexToOklch('#e5e9f0')
    expect(Math.abs(top.l - ink.l)).toBeLessThan(0.05)
  })

  test('everforest-dark stays in the dark luminance window', () => {
    const scale = generateNeutralScale('#2d353b', true, '#d3c6aa')
    const bg = hexToOklch(scale[0])
    expect(bg.l).toBeGreaterThan(0.13)
    expect(bg.l).toBeLessThan(0.3)
  })
})

describe('generateNeutralAlphaScale', () => {
  test('returns 12 entries; step 1 is lighter than bg (moves toward ink)', () => {
    const neutral = generateNeutralScale('#393939', true, '#f2f4f8')
    const alpha = generateNeutralAlphaScale(neutral, true)
    expect(alpha.length).toBe(12)
    const bg = hexToOklch(neutral[0])
    const step1 = hexToOklch(alpha[1])
    expect(step1.l).toBeGreaterThan(bg.l)
  })
})

describe('generateScale (opencode parity, pinned ff748b82ca55)', () => {
  test('#88c0d0 dark produces the upstream-exact 12-step scale', () => {
    expect(generateScale('#88c0d0', true)).toEqual([
      '#00070a',
      '#010b0f',
      '#011217',
      '#021a21',
      '#02252e',
      '#063540',
      '#0e4a57',
      '#036579',
      '#369ab3',
      '#41aac5',
      '#8be3fb',
      '#f2fcff',
    ])
  })

  test('#ff6767 light produces the upstream-exact 12-step scale', () => {
    expect(generateScale('#ff6767', false)).toEqual([
      '#fffcfc',
      '#fef8f7',
      '#feeeed',
      '#ffe2e0',
      '#fcd5d2',
      '#fec1bd',
      '#ffa6a1',
      '#ff7e7b',
      '#fe6868',
      '#fc4d53',
      '#b60123',
      '#4f010a',
    ])
  })

  test('scale[8] dark uses clamp(base.l*0.825, 0.53, 0.705)', () => {
    const base = hexToOklch('#88c0d0')
    const [, , , , , , , , eighth] = generateScale('#88c0d0', true)
    const expectedL = Math.max(0.53, Math.min(0.705, base.l * 0.825))
    expect(hexToOklch(eighth ?? '#000000').l).toBeCloseTo(expectedL, 2)
  })

  test('scale[8] light = base.l (seed at index 8)', () => {
    const base = hexToOklch('#ff6767')
    const [, , , , , , , , eighth] = generateScale('#ff6767', false)
    expect(hexToOklch(eighth ?? '#000000').l).toBeCloseTo(base.l, 2)
  })
})

describe('generateAlphaScale (opencode parity, pinned ff748b82ca55)', () => {
  test('#88c0d0 dark alpha scale matches upstream verbatim', () => {
    const base = generateScale('#88c0d0', true)
    expect(generateAlphaScale(base, true)).toEqual([
      '#000000',
      '#000001',
      '#000102',
      '#000304',
      '#000607',
      '#010b0d',
      '#041317',
      '#01242c',
      '#18444f',
      '#225866',
      '#6aadbf',
      '#e8f2f5',
    ])
  })

  test('#ff6767 light alpha scale matches upstream verbatim', () => {
    const base = generateScale('#ff6767', false)
    expect(generateAlphaScale(base, false)).toEqual([
      '#ffffff',
      '#ffffff',
      '#fffefe',
      '#fffcfc',
      '#fffafa',
      '#fff6f5',
      '#ffedec',
      '#ffdbda',
      '#ffb7b7',
      '#fd9b9f',
      '#d05c72',
      '#641f27',
    ])
  })
})

describe('withAlpha', () => {
  test('emits an rgba(...) string with rounded 0..255 channels', () => {
    expect(withAlpha('#88c0d0', 0.3)).toBe('rgba(136, 192, 208, 0.3)')
  })
  test('passes alpha through verbatim', () => {
    expect(withAlpha('#ff6767', 0.5)).toBe('rgba(255, 103, 103, 0.5)')
  })
})

describe('computeSurfaces', () => {
  const carbonfoxLight = {
    accent: '#da1e28',
    error: '#da1e28',
    info: '#0043ce',
    ink: '#161616',
    interactive: '#0f62fe',
    neutral: '#8e8e8e',
    primary: '#0072c3',
    success: '#198038',
    warning: '#f1c21b',
  } as const

  const nordDark = {
    accent: '#d57780',
    error: '#bf616a',
    info: '#81a1c1',
    ink: '#e5e9f0',
    neutral: '#2e3440',
    primary: '#88c0d0',
    success: '#a3be8c',
    warning: '#d08770',
  } as const

  test('carbonfox-light surfaces land in the light window', () => {
    const s = computeSurfaces(carbonfoxLight, 'light')
    const bg = hexToOklch(s.bg)
    expect(bg.l).toBeGreaterThan(0.9)
    expect(s.bg).not.toBe(carbonfoxLight.neutral)
  })

  test('nord-dark surfaces land in the dark window', () => {
    const s = computeSurfaces(nordDark, 'dark')
    const bg = hexToOklch(s.bg)
    expect(bg.l).toBeGreaterThan(0.15)
    expect(bg.l).toBeLessThan(0.28)
  })

  test('selected is a subtle primary tint over the computed bg (not raw interactive)', () => {
    const s = computeSurfaces(carbonfoxLight, 'light')
    // never the raw electric-blue interactive seed
    expect(s.selected).not.toBe('#0f62fe')
    // stays close to bg (18% primary tint)
    const bg = hexToOklch(s.bg)
    const sel = hexToOklch(s.selected)
    expect(Math.abs(sel.l - bg.l)).toBeLessThan(0.25)
  })

  test('selected still produces a valid hex when interactive is absent', () => {
    const s = computeSurfaces(nordDark, 'dark')
    expect(s.selected.startsWith('#')).toBe(true)
    expect(s.selected).not.toBe(nordDark.neutral)
  })
})

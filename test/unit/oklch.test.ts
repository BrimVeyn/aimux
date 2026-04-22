import { describe, expect, test } from 'bun:test'

import {
  blend,
  hexToOklch,
  hexToRgb,
  mixColors,
  oklchToHex,
  rgbToHex,
  shift,
} from '../../packages/aimux-config/src/oklch'

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

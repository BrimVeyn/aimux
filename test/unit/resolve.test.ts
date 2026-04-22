import { describe, expect, test } from 'bun:test'

import { resolveTheme } from '../../packages/aimux-config/src/resolve'

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
  interactive: '#88c0d0',
  neutral: '#2e3440',
  primary: '#88c0d0',
  success: '#a3be8c',
  warning: '#d08770',
} as const

describe('resolveTheme — opencode 1:1 parity (pinned ff748b82ca55)', () => {
  test('carbonfox-light pinned tokens match upstream verbatim', () => {
    const t = resolveTheme(carbonfoxLight, 'light')
    expect(t['background-base']).toBe('#eeeeee')
    expect(t['surface-base']).toBe('#e1e1e1')
    expect(t['surface-base-active']).toBe('#d9d9d9')
    expect(t['text-base']).toBe('#151515')
    expect(t['text-weak']).toBe('#2f2f2f')
    expect(t['border-base']).toBe('#b9b9b9')
    expect(t['border-interactive-base']).toBe('#a1c2fd')
    expect(t['surface-diff-add-weak']).toBe('#f1fdf3')
    expect(t['surface-diff-delete-weak']).toBe('#fff8f7')
    expect(t['syntax-string']).toBe('#0c6c2c')
    expect(t['markdown-text']).toBe('#151515')
    expect(t['text-stronger']).toBe('#070707')
  })

  test('nord-dark pinned tokens match upstream verbatim', () => {
    const t = resolveTheme(nordDark, 'dark')
    expect(t['background-base']).toBe('#191e29')
    expect(t['surface-base']).toBe('#262b36')
    expect(t['surface-base-active']).toBe('#2d323d')
    expect(t['text-base']).toBe('#e5e9f0')
    expect(t['text-weak']).toBe('#c2c5cb')
    expect(t['border-base']).toBe('#4f545e')
    expect(t['border-interactive-base']).toBe('#0e4a57')
    expect(t['surface-diff-add-weak']).toBe('#0d1b00')
    expect(t['surface-diff-delete-weak']).toBe('#30030b')
    expect(t['syntax-string']).toBe('#b9f481')
    expect(t['markdown-text']).toBe('#e5e9f0')
    expect(t['text-stronger']).toBe('#fcfdfe')
  })
})

describe('resolveTheme — overrides passthrough', () => {
  test('hex override wins over computed value', () => {
    const t = resolveTheme(nordDark, 'dark', { 'text-base': '#ff00ff' })
    expect(t['text-base']).toBe('#ff00ff')
  })

  test('text-stronger back-fills from text-strong when not overridden', () => {
    const t = resolveTheme(nordDark, 'dark')
    expect(t['text-stronger']).toBe(t['text-strong'])
  })

  test('text-stronger override wins over back-fill', () => {
    const t = resolveTheme(nordDark, 'dark', { 'text-stronger': '#abcdef' })
    expect(t['text-stronger']).toBe('#abcdef')
  })

  test('compact-mode text-weak override derives text-weaker via shift', () => {
    const t = resolveTheme(nordDark, 'dark', { 'text-weak': '#aaaaaa' })
    expect(t['text-weak']).toBe('#aaaaaa')
    // back-fill: text-weaker shifts the override (l: -0.12, c: 0.75) for dark
    expect(t['text-weaker']).not.toBe('#aaaaaa')
    expect(t['text-weaker'].startsWith('#')).toBe(true)
  })

  test('CSS-var override on background-base flips alphaTone-based tokens to rgba', () => {
    const t = resolveTheme(nordDark, 'dark', { 'background-base': 'var(--bg)' })
    expect(t['background-base']).toBe('var(--bg)')
    // borderTone() routes through alphaTone() — flips to rgba in overlay mode
    expect(t['border-base'].startsWith('rgba(')).toBe(true)
    // neutralAlpha[i]-derived surfaces stay hex (pre-blended against neutral bg)
    expect(t['surface-base'].startsWith('#')).toBe(true)
  })

  test('hex background-base override keeps blend mode (border stays hex)', () => {
    const t = resolveTheme(nordDark, 'dark', { 'background-base': '#000000' })
    expect(t['background-base']).toBe('#000000')
    expect(t['border-base'].startsWith('#')).toBe(true)
  })
})

describe('resolveTheme — diff seed fallback', () => {
  test('absent diffAdd derives from success via shift', () => {
    // nord-dark has no diffAdd seed; resolver should derive
    const t = resolveTheme(nordDark, 'dark')
    expect(t['surface-diff-add-weak'].startsWith('#')).toBe(true)
    expect(t['surface-diff-add-weak']).not.toBe('#000000')
  })

  test('present diffAdd seed is used directly', () => {
    const withDiff = { ...nordDark, diffAdd: '#00ff00' }
    const t = resolveTheme(withDiff, 'dark')
    // diff-add scale derived from #00ff00 → very green tones
    const weak = t['surface-diff-add-weak']
    expect(weak.startsWith('#')).toBe(true)
  })
})

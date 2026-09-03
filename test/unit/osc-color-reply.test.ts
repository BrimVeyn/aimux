import { describe, expect, test } from 'bun:test'

import { paletteQueryIndices, toOscColor } from '../../src/pty/pty-manager'

describe('toOscColor', () => {
  test('widens each byte to the 16-bit form OSC replies use', () => {
    expect(toOscColor('#1e1e2e')).toBe('rgb:1e1e/1e1e/2e2e')
    expect(toOscColor('cdd6f4')).toBe('rgb:cdcd/d6d6/f4f4')
  })

  test('refuses anything that is not a six-digit hex', () => {
    for (const value of [undefined, '', 'transparent', '#fff', '#1e1e2eff']) {
      expect(toOscColor(value)).toBeUndefined()
    }
  })
})

describe('paletteQueryIndices', () => {
  test('picks the queried indices out of a run of pairs', () => {
    expect(paletteQueryIndices('0;?')).toEqual([0])
    expect(paletteQueryIndices('1;?;2;#ff0000;3;?')).toEqual([1, 3])
  })

  test('ignores sets, junk and out-of-range indices', () => {
    expect(paletteQueryIndices('2;#ff0000')).toEqual([])
    expect(paletteQueryIndices('256;?;-1;?;x;?')).toEqual([])
    expect(paletteQueryIndices('')).toEqual([])
  })
})

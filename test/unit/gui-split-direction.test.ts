import { describe, expect, test } from 'bun:test'

// The mapping rule (kept identical in desktop/src/lib/split.ts):
// aimux 'vertical' split = side-by-side = react-resizable-panels 'horizontal';
// aimux 'horizontal' split = stacked = react-resizable-panels 'vertical'.
function aimuxToRrpDirection(d: 'horizontal' | 'vertical'): 'horizontal' | 'vertical' {
  return d === 'vertical' ? 'horizontal' : 'vertical'
}

describe('aimuxToRrpDirection', () => {
  test('aimux vertical split -> RRP horizontal (side by side)', () => {
    expect(aimuxToRrpDirection('vertical')).toBe('horizontal')
  })
  test('aimux horizontal split -> RRP vertical (stacked)', () => {
    expect(aimuxToRrpDirection('horizontal')).toBe('vertical')
  })
})

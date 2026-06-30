import { describe, expect, test } from 'bun:test'

import type { TerminalSnapshot } from '../../src/state/types'

import { snapshotTailLines, snapshotToLines } from '../../src/cli/snapshot-render'

function snapshot(lines: string[]): TerminalSnapshot {
  return {
    baseY: 0,
    cursorVisible: true,
    lines: lines.map((line) => ({ spans: [{ text: line }] })),
    viewportY: 0,
  }
}

describe('snapshot-render', () => {
  test('flattens spans line-by-line', () => {
    const snap: TerminalSnapshot = {
      baseY: 0,
      cursorVisible: true,
      lines: [
        { spans: [{ text: 'hello ' }, { text: 'world' }] },
        { spans: [{ text: 'second line' }] },
      ],
      viewportY: 0,
    }
    expect(snapshotToLines(snap)).toEqual(['hello world', 'second line'])
  })

  test('tail trims trailing blanks then slices', () => {
    const snap = snapshot(['one', 'two', 'three', '', ''])
    expect(snapshotTailLines(snap, 2)).toEqual(['two', 'three'])
  })

  test('tail with n=0 returns the whole non-blank prefix', () => {
    const snap = snapshot(['one', 'two', '', ''])
    expect(snapshotTailLines(snap, 0)).toEqual(['one', 'two'])
  })
})

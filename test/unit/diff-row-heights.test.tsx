import { testRender } from '@opentui/react/test-utils'
import { describe, expect, test } from 'bun:test'
import { act } from 'react'

import { PierreDiff } from '../../src/ui/components/git/diff-renderer'
import { expandTabs, wrapCount } from '../../src/ui/components/git/diff-renderer/build-rows'

describe('wrapCount', () => {
  test('counts display columns, wrapping by character', () => {
    expect(wrapCount('abcd', 4)).toBe(1)
    expect(wrapCount('abcde', 4)).toBe(2)
    expect(wrapCount('', 4)).toBe(1)
    // Not measured yet: one row each, nothing worked out from a guess.
    expect(wrapCount('a'.repeat(500), 0)).toBe(1)
  })

  test('a tab is as wide as the renderer draws it', () => {
    expect(expandTabs('\tx')).toBe('    x')
    expect(wrapCount('\tx', 5)).toBe(1)
    expect(wrapCount('\t\tx', 5)).toBe(2)
  })

  test('wide characters take two columns', () => {
    expect(wrapCount('日本語', 4)).toBe(2)
    expect(wrapCount('🙂🙂', 4)).toBe(1)
  })
})

// The bug these pin: every row was drawn at a height worked out for a width taken
// from the whole screen — bars that git mode does not draw, no file list — and for
// a word wrap the renderer did not do. Lines got blank rows under them, or lost
// their tail. What is on screen must be the file, row for row.

const LINES = [
  "import { memo, useEffect, useState } from 'react'",
  '',
  "import { imageMimeFromPath, isImagePath } from '../../../../git/image-detect'",
  '\tconst indented = true',
  'const short = 1',
  '// a comment long enough to wrap more than once in a narrow pane, and then some more words',
  'end',
]

function newFilePatch(lines: readonly string[]): string {
  return [
    '--- /dev/null',
    '+++ b/x.ts',
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((l) => `+${l}`),
    '',
  ].join('\n')
}

/**
 * The text of a pane read back off the frame: each numbered row starts a line,
 * each row with an empty gutter continues it. A row that is neither is a blank
 * row the layout left behind.
 */
function readBack(rows: readonly string[], gutter: RegExp): { blank: number; lines: string[] } {
  const lines: string[] = []
  let blank = 0
  let gutterWidth = 0
  for (const row of rows) {
    const numbered = gutter.exec(row)
    if (numbered) {
      gutterWidth = numbered[0].length
      lines.push(row.slice(gutterWidth))
    } else if (row.trim() === '') {
      blank++
    } else {
      // Rows are joined untrimmed: a wrap can fall on a space, at either end.
      lines[lines.length - 1] = `${lines.at(-1) ?? ''}${row.slice(gutterWidth)}`
    }
  }
  return { blank, lines: lines.map((l) => l.trimEnd()) }
}

async function settle(renderOnce: () => Promise<void>): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Bun.sleep(30)
    })
    await renderOnce()
  }
}

describe.each(['stacked', 'split'] as const)('%s diff rows', (view) => {
  async function frameRows(width: number): Promise<{
    resize: (w: number) => Promise<string[]>
    rows: string[]
  }> {
    const { captureCharFrame, renderOnce, resize } = await testRender(
      <PierreDiff
        cacheKey={`rows-${view}-${width}`}
        diff={newFilePatch(LINES)}
        path="x.ts"
        themeId="t"
        view={view}
      />,
      { height: 40, width }
    )
    await settle(renderOnce)
    // In split the new file is the right-hand pane: read from its gutter on.
    const cut = (frame: string): string[] => {
      const rows = frame.split('\n').filter((r) => r.trimEnd() !== '')
      const lines = rows.slice(1)
      if (view === 'stacked') return lines
      const start = rows[0]?.lastIndexOf('@@ -0,0') ?? 0
      return lines.map((r) => r.slice(start))
    }
    return {
      resize: async (w: number) => {
        resize(w, 40)
        await settle(renderOnce)
        return cut(captureCharFrame())
      },
      rows: cut(captureCharFrame()),
    }
  }

  // ` 1 + ` / ` 1   1 + `: line numbers, then the sign. Empty source lines have a
  // gutter too, so they still count as lines, not as blank rows.
  const gutter = /^\s*\d+ \+ /

  function check(rows: readonly string[]): void {
    const { blank, lines } = readBack(rows, gutter)
    expect(blank).toBe(0)
    expect(lines).toEqual(LINES.map((l) => expandTabs(l)))
  }

  test('wide pane: every line on its rows, nothing blank, nothing cut', async () => {
    check((await frameRows(160)).rows)
  })

  test('narrow pane: wrapped lines keep every character and leave no gap', async () => {
    check((await frameRows(70)).rows)
  })

  test('the rows follow the pane when it is resized', async () => {
    const pane = await frameRows(160)
    check(await pane.resize(64))
    check(await pane.resize(120))
  })
})

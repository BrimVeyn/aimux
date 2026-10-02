import { testRender } from '@opentui/react/test-utils'
import { describe, expect, test } from 'bun:test'
import { act } from 'react'

import type { DiffData, GitDiffView } from '../../src/state/types'

import { lcsDiff } from '../../src/markdown-diff/lcs'
import { MarkdownDiffView } from '../../src/ui/components/git/markdown-diff'
import { scrollGitDiff } from '../../src/ui/git-view-controls'

// A full-context patch, the shape fetchDiff asks git for.
function patch(before: string, after: string): string {
  const body = lcsDiff(before.split('\n'), after.split('\n'), (l) => l).map((op) => {
    if (op.type === 'same') return ` ${op.a}`
    if (op.type === 'del') return `-${op.a}`
    return `+${op.b}`
  })
  return ['--- a/doc.md', '+++ b/doc.md', '@@ -1 +1 @@', ...body, ''].join('\n')
}

function mdDiff(before: string, after: string): DiffData {
  return { path: 'doc.md', rawDiff: patch(before, after), status: 'modified' }
}

async function render(
  before: string,
  after: string,
  opts: { expandAll?: boolean; height?: number; view?: GitDiffView } = {}
) {
  const diff = mdDiff(before, after)
  const result = await testRender(
    <MarkdownDiffView
      diff={diff}
      expandAll={opts.expandAll ?? false}
      repoRoot={null}
      themeId="test"
      view={opts.view ?? 'stacked'}
    />,
    { height: opts.height ?? 40, width: 100 }
  )
  await result.renderOnce()
  await act(async () => {
    await Bun.sleep(20)
  })
  await result.renderOnce()
  return result
}

const paragraphs = (n: number): string =>
  Array.from({ length: n }, (_, i) => `Paragraph number ${i + 1}.`).join('\n\n')

describe('MarkdownDiffView', () => {
  test('draws the document with each change signed in the gutter', async () => {
    const { captureCharFrame } = await render(
      '# Title\n\nThe quick brown fox.\n\n- a\n- c\n',
      '# Title\n\nThe quick red fox.\n\n- a\n- b\n- c\n'
    )
    const frame = captureCharFrame()
    expect(frame).toContain('rendered · 2 blocks changed · r source')
    expect(frame).toContain('  # Title')
    // Stacked: the edit reads as one paragraph, both versions of the word kept.
    expect(frame).toContain('~ The quick brownred fox.')
    expect(frame).toContain('+ • b')
    // List items stay on consecutive lines.
    expect(frame).toMatch(/• a\s*\n\+ • b\s*\n {2}• c/)
  })

  test('split puts each version on its own side, aligned', async () => {
    const { captureCharFrame } = await render('The quick brown fox.\n', 'The quick red fox.\n', {
      view: 'split',
    })
    expect(captureCharFrame()).toMatch(/~ The quick brown fox\.\s+~ The quick red fox\./)
  })

  test('folds long unchanged runs, and e unfolds them', async () => {
    const before = `${paragraphs(12)}\n\nThe end.\n`
    const after = `${paragraphs(12)}\n\nThe very end.\n`
    const folded = await render(before, after, { height: 60 })
    expect(folded.captureCharFrame()).toContain('··· 10 unchanged blocks')
    expect(folded.captureCharFrame()).not.toContain('Paragraph number 1.')

    const open = await render(before, after, { expandAll: true, height: 60 })
    expect(open.captureCharFrame()).not.toContain('unchanged blocks')
    expect(open.captureCharFrame()).toContain('Paragraph number 1.')
  })

  test('opens on the first change, and the scroll keys move the document', async () => {
    const before = `${paragraphs(30)}\n\nThe end.\n`
    const after = `${paragraphs(30)}\n\nThe very end.\n`
    const { captureCharFrame, renderOnce } = await render(before, after, {
      expandAll: true,
      height: 12,
    })
    await act(async () => {
      await Bun.sleep(20)
    })
    await renderOnce()
    expect(captureCharFrame()).toContain('The very end.')
    expect(captureCharFrame()).not.toContain('Paragraph number 1.')

    await act(async () => scrollGitDiff(-1000))
    await renderOnce()
    expect(captureCharFrame()).toContain('Paragraph number 1.')
  })

  test('a ticked checkbox shows both states of the marker', async () => {
    const { captureCharFrame } = await render('- [ ] ship it\n', '- [x] ship it\n')
    expect(captureCharFrame()).toContain('~ ☐☑ ship it')
  })

  test('says so when the rendered document did not change', async () => {
    const { captureCharFrame } = await render('Same text.\n', 'Same text.\n')
    expect(captureCharFrame()).toContain('no changes in the rendered document')
  })
})

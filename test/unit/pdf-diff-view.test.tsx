import { testRender } from '@opentui/react/test-utils'
import { describe, expect, test } from 'bun:test'
import { act } from 'react'

import type { DiffData } from '../../src/state/types'

import { PdfDiffView } from '../../src/ui/components/git/pdf-diff'
import { scrollGitDiff } from '../../src/ui/git-view-controls'
import { makePdf } from '../fixtures/make-pdf'

const hasPoppler = Bun.which('pdftoppm') !== null && Bun.which('pdfinfo') !== null

function pdfDiff(before: string[], after: string[]): DiffData {
  return {
    path: 'doc.pdf',
    pdfBytesAfter: makePdf(after),
    pdfBytesBefore: makePdf(before),
    rawDiff: '',
    status: 'pdf',
  }
}

async function settle(renderOnce: () => Promise<void>, until: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !until(); i++) {
    await act(async () => {
      await Bun.sleep(20)
    })
    await renderOnce()
  }
}

// The test renderer speaks no graphics protocol, so what is checked here is the
// page bookkeeping around the pixels: where the view opens, and where the scroll
// keys take it.
describe.skipIf(!hasPoppler)('PdfDiffView', () => {
  test('opens on the first changed page and every page stays reachable', async () => {
    const diff = pdfDiff(['a', 'b', 'c', 'd', 'e'], ['a', 'B', 'c', 'd', 'E'])
    const { captureCharFrame, renderOnce } = await testRender(<PdfDiffView diff={diff} />, {
      height: 20,
      width: 100,
    })
    await renderOnce()
    await settle(renderOnce, () => captureCharFrame().includes('changed: 2, 5'))

    expect(captureCharFrame()).toContain('page 2 / 5 · changed · changed: 2, 5')

    // Every scroll key turns one page, unchanged pages included — a page-down too.
    await act(async () => scrollGitDiff(1))
    await renderOnce()
    expect(captureCharFrame()).toContain('page 3 / 5 · unchanged')

    await act(async () => scrollGitDiff(20))
    await renderOnce()
    expect(captureCharFrame()).toContain('page 4 / 5 · unchanged')

    await act(async () => scrollGitDiff(20))
    await act(async () => scrollGitDiff(20))
    await renderOnce()
    expect(captureCharFrame()).toContain('page 5 / 5 · changed')

    for (let i = 0; i < 6; i++) await act(async () => scrollGitDiff(-1))
    await renderOnce()
    expect(captureCharFrame()).toContain('page 1 / 5 · unchanged')
  })

  test('a page only the new side has reads as absent on the old one', async () => {
    const diff = pdfDiff(['a'], ['a', 'b'])
    const { captureCharFrame, renderOnce } = await testRender(<PdfDiffView diff={diff} />, {
      height: 20,
      width: 100,
    })
    await renderOnce()
    await settle(renderOnce, () => captureCharFrame().includes('(no page 2)'))
    expect(captureCharFrame()).toContain('page 2 / 2')
    expect(captureCharFrame()).toContain('(no page 2)')
  })
})

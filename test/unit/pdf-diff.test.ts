import { $ } from 'bun'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { GitFileEntry } from '../../src/state/types'

import { MAX_DIFF_BYTES, MAX_PDF_DIFF_BYTES } from '../../src/git/diff-limits'
import { fetchDiff } from '../../src/git/git-diff'
import { isPng } from '../../src/ui/terminal-graphics/format-fallback'
import {
  changedPages,
  pdfPageCount,
  pdfPageFingerprints,
  renderPdfPage,
} from '../../src/ui/terminal-graphics/pdf-render'
import { makePdf } from '../fixtures/make-pdf'

function modified(path: string): GitFileEntry {
  return { path, section: 'unstaged', status: 'M' } as GitFileEntry
}

function untracked(path: string): GitFileEntry {
  return { path, section: 'untracked', status: '?' } as GitFileEntry
}

const hasPoppler = Bun.which('pdftoppm') !== null && Bun.which('pdfinfo') !== null

describe('fetchDiff on a PDF', () => {
  let repo: string

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'aimux-pdf-diff-'))
    await $`git -C ${repo} init -q`.quiet()
    await $`git -C ${repo} config user.email test@aimux.dev`.quiet()
    await $`git -C ${repo} config user.name test`.quiet()
    await writeFile(join(repo, 'doc.pdf'), makePdf(['one', 'two']))
    await $`git -C ${repo} add -A`.quiet()
    await $`git -C ${repo} commit -qm seed`.quiet()
  })

  afterAll(async () => {
    await rm(repo, { force: true, recursive: true })
  })

  test('reads both sides as bytes instead of calling it binary', async () => {
    await writeFile(join(repo, 'doc.pdf'), makePdf(['one', 'TWO']))
    const diff = await fetchDiff(repo, modified('doc.pdf'))
    expect(diff.status).toBe('pdf')
    expect(diff.pdfBytesBefore?.byteLength).toBeGreaterThan(0)
    expect(diff.pdfBytesAfter?.byteLength).toBeGreaterThan(0)
    expect(diff.rawDiff).toBe('')
  })

  test('accepts a PDF past the text limit, up to its own', async () => {
    // Padding after %%EOF is ignored by readers; it only has to weigh.
    const padded = new Uint8Array(MAX_DIFF_BYTES + 1024)
    padded.set(makePdf(['big']))
    await writeFile(join(repo, 'big.pdf'), padded)
    const diff = await fetchDiff(repo, untracked('big.pdf'))
    expect(diff.status).toBe('pdf')
    expect(diff.pdfBytesBefore).toBeUndefined()
    expect(diff.pdfBytesAfter?.byteLength).toBe(padded.byteLength)
  })

  test('refuses a PDF past its own limit', async () => {
    await writeFile(join(repo, 'huge.pdf'), new Uint8Array(MAX_PDF_DIFF_BYTES + 1024))
    const diff = await fetchDiff(repo, untracked('huge.pdf'))
    expect(diff.status).toBe('too-large')
  })
})

test('changedPages compares by position and counts pages only one side has', () => {
  expect(changedPages(['a', 'b', 'c'], ['a', 'x', 'c'])).toEqual([2])
  expect(changedPages(['a'], ['a', 'b', 'c'])).toEqual([2, 3])
  expect(changedPages(['a', 'b'], ['a', 'b'])).toEqual([])
})

describe.skipIf(!hasPoppler)('rendering through poppler', () => {
  test('counts pages', async () => {
    expect(await pdfPageCount(makePdf(['a', 'b', 'c']))).toBe(3)
  })

  test('renders a single page to PNG', async () => {
    const result = await renderPdfPage(makePdf(['a', 'b']), 2, 36)
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') expect(isPng(result.png)).toBe(true)
  })

  test('fingerprints tell a changed page from an identical one', async () => {
    const [before, after] = await Promise.all([
      pdfPageFingerprints(makePdf(['same', 'old', 'same'])),
      pdfPageFingerprints(makePdf(['same', 'new', 'same'])),
    ])
    expect(before).toHaveLength(3)
    expect(changedPages(before ?? [], after ?? [])).toEqual([2])
  })
})

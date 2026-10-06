import { testRender } from '@opentui/react/test-utils'
import { $ } from 'bun'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { act, createRef } from 'react'

import { buildContextPatch, loadFileView, readFileAsIs } from '../../src/git/file-view'
import { fileChange, listRepoFiles } from '../../src/git/repo-files'
import { FileView, type FileViewHandle } from '../../src/ui/components/git/file-view/file-view'
import { makePdf } from '../fixtures/make-pdf'

/**
 * A repository with one of everything a browser meets: an untouched file, a
 * changed one, a staged addition, an untracked one, a deleted one, an ignored
 * one, a binary, a PDF and an empty file.
 */
let repo = ''

const CLEAN = ['const a = 1', 'const b = 2', 'const c = 3', ''].join('\n')

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), 'aimux-file-view-'))
  await $`git init -b main ${repo}`.quiet()
  await $`git -C ${repo} config user.email test@example.com`.quiet()
  await $`git -C ${repo} config user.name test`.quiet()
  await $`mkdir -p ${join(repo, 'src')} ${join(repo, 'docs')}`.quiet()
  await writeFile(join(repo, 'src/clean.ts'), CLEAN)
  await writeFile(join(repo, 'src/changed.ts'), 'let x = 1\nlet y = 2\n')
  await writeFile(join(repo, 'docs/gone.md'), '# Gone\n')
  await writeFile(join(repo, '.gitignore'), 'ignored.log\n')
  await writeFile(join(repo, 'blob.bin'), new Uint8Array([1, 0, 2, 0, 3]))
  await writeFile(join(repo, 'doc.pdf'), makePdf(['one', 'two']))
  await writeFile(join(repo, 'empty.txt'), '')
  await $`git -C ${repo} add -A`.quiet()
  await $`git -C ${repo} commit -m first`.quiet()

  await writeFile(join(repo, 'src/changed.ts'), 'let x = 1\nlet y = 3\n')
  await writeFile(join(repo, 'src/added.ts'), 'export {}\n')
  await $`git -C ${repo} add src/added.ts`.quiet()
  await writeFile(join(repo, 'notes.txt'), 'untracked\n')
  await writeFile(join(repo, 'ignored.log'), 'noise\n')
  await unlink(join(repo, 'docs/gone.md'))
})

afterAll(async () => {
  await rm(repo, { force: true, recursive: true })
})

describe('listRepoFiles', () => {
  test('every file, tracked or not, ignored ones left out, with what changed', async () => {
    const files = await listRepoFiles(repo)
    const byPath = Object.fromEntries(files.map((f) => [f.path, f.change?.status ?? null]))
    expect(byPath).toEqual({
      '.gitignore': null,
      'blob.bin': null,
      'doc.pdf': null,
      'docs/gone.md': 'D',
      'empty.txt': null,
      'notes.txt': '?',
      'src/added.ts': 'A',
      'src/changed.ts': 'M',
      'src/clean.ts': null,
    })
    expect(files.map((f) => f.path)).toEqual(Object.keys(byPath).sort())
  })

  test('changed files carry their lines added and removed against HEAD', async () => {
    const files = await listRepoFiles(repo)
    const counts = Object.fromEntries(
      files.filter((f) => f.change !== null).map((f) => [f.path, [f.added, f.removed]])
    )
    expect(counts).toEqual({
      'docs/gone.md': [0, 1],
      'notes.txt': [1, 0],
      'src/added.ts': [1, 0],
      'src/changed.ts': [1, 1],
    })
    expect(files.find((f) => f.path === 'src/clean.ts')?.added).toBeNull()
  })

  test('a directory that is not a repository is an error, not an empty tree', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'aimux-not-a-repo-'))
    try {
      const error = await listRepoFiles(outside).then(
        () => null,
        (error: unknown) => error
      )
      expect(error).toBeInstanceOf(Error)
    } finally {
      await rm(outside, { force: true, recursive: true })
    }
  })

  test('fileChange answers for one path', async () => {
    expect((await fileChange(repo, 'src/changed.ts'))?.status).toBe('M')
    expect(await fileChange(repo, 'src/clean.ts')).toBeNull()
    expect((await fileChange(repo, 'notes.txt'))?.section).toBe('untracked')
  })
})

describe('loadFileView', () => {
  test('an untouched file is its text, every line kept', async () => {
    const view = await loadFileView(repo, 'src/clean.ts')
    expect(view).toEqual({ kind: 'text', patch: buildContextPatch('src/clean.ts', CLEAN) })
  })

  test('a changed file is the diff git mode would show', async () => {
    const view = await loadFileView(repo, 'src/changed.ts')
    if (view.kind !== 'diff') throw new Error(`expected a diff, got ${view.kind}`)
    expect(view.diff.status).toBe('modified')
    expect(view.diff.rawDiff).toContain('-let y = 2')
    expect(view.diff.rawDiff).toContain('+let y = 3')
  })

  test('asked for as it is, a changed file is read off the disk', async () => {
    const view = await loadFileView(repo, 'src/changed.ts', 'file')
    expect(view).toEqual({
      kind: 'text',
      patch: buildContextPatch('src/changed.ts', 'let x = 1\nlet y = 3\n'),
    })
  })

  test('an untracked file has nothing to be compared with: read as it is', async () => {
    expect((await loadFileView(repo, 'notes.txt')).kind).toBe('text')
  })

  test('a deleted file is all removals, or not on disk when asked for as it is', async () => {
    const view = await loadFileView(repo, 'docs/gone.md')
    if (view.kind !== 'diff') throw new Error(`expected a diff, got ${view.kind}`)
    expect(view.diff.rawDiff).toContain('-# Gone')
    expect((await loadFileView(repo, 'docs/gone.md', 'file')).kind).toBe('missing')
  })

  test('binary, empty and PDF files each get their own kind', async () => {
    expect(await readFileAsIs(repo, 'blob.bin')).toEqual({ kind: 'binary', size: 5 })
    expect(await readFileAsIs(repo, 'empty.txt')).toEqual({ kind: 'empty' })
    const pdf = await readFileAsIs(repo, 'doc.pdf')
    if (pdf.kind !== 'pdf') throw new Error(`expected a pdf, got ${pdf.kind}`)
    // One side only: there is nothing to compare it with.
    expect(pdf.diff.pdfBytesBefore).toBeUndefined()
    expect(pdf.diff.pdfBytesAfter?.byteLength).toBeGreaterThan(0)
  })
})

describe('buildContextPatch', () => {
  test('every line kept, the final newline ending the last one', () => {
    expect(buildContextPatch('a.txt', 'x\ny\n')).toBe(
      '--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n x\n y\n'
    )
    expect(buildContextPatch('a.txt', 'x')).toBe('--- a/a.txt\n+++ b/a.txt\n@@ -1,1 +1,1 @@\n x\n')
    expect(buildContextPatch('a.txt', '')).toBe('')
  })
})

async function settle(renderOnce: () => Promise<void>): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await Bun.sleep(30)
    })
    await renderOnce()
  }
}

describe('FileView', () => {
  test('an untouched file: one line number, no sign, no hunk header', async () => {
    const { captureCharFrame, renderOnce } = await testRender(
      <FileView cwd={repo} path="src/clean.ts" themeId="aimux" />,
      { height: 10, width: 60 }
    )
    await settle(renderOnce)
    const rows = captureCharFrame()
      .split('\n')
      .map((r) => r.trimEnd())
      .filter((r) => r !== '')
    expect(rows).toEqual(['  1 const a = 1', '  2 const b = 2', '  3 const c = 3'])
  })

  test('a changed file: both sides, split', async () => {
    const { captureCharFrame, renderOnce } = await testRender(
      <FileView cwd={repo} path="src/changed.ts" themeId="aimux" />,
      { height: 10, width: 80 }
    )
    await settle(renderOnce)
    const frame = captureCharFrame()
    const row = frame.split('\n').find((r) => r.includes('let y = 2'))
    expect(row).toContain('let y = 3')
  })

  test('the handle scrolls the file it shows, and nothing else', async () => {
    const long = Array.from({ length: 80 }, (_, i) => `line ${i + 1}`).join('\n')
    await writeFile(join(repo, 'long.txt'), long)
    const handle = createRef<FileViewHandle>()
    const { captureCharFrame, renderOnce } = await testRender(
      <FileView ref={handle} cwd={repo} path="long.txt" themeId="aimux" />,
      { height: 10, width: 40 }
    )
    await settle(renderOnce)
    const top = (): string => (captureCharFrame().split('\n')[0] ?? '').replace('▀', '').trim()
    expect(top()).toBe('1 line 1')
    await act(async () => handle.current?.scroll(30))
    await settle(renderOnce)
    expect(top()).toBe('31 line 31')
  })
})

import type { DiffData } from '../state/types'

import { diffByteLimit, isPdfPath } from './diff-limits'
import { fetchDiff } from './git-diff'
import { imageFormatLabel, imageMimeFromPath, isImagePath } from './image-detect'
import { fileChange } from './repo-files'

/**
 * One file of a repository, ready to draw: as a diff when it has changed and
 * the caller wants to see how, as it is otherwise.
 */
export type FileViewContent =
  | { kind: 'binary'; size: number }
  | { kind: 'diff'; diff: DiffData }
  | { kind: 'empty' }
  | { kind: 'image'; diff: DiffData }
  | { kind: 'missing' }
  | { kind: 'pdf'; diff: DiffData }
  | { kind: 'text'; patch: string }
  | { kind: 'too-large'; limit: number; size: number }

/** `diff` shows a changed file as a change; `file` always shows what is on disk. */
export type FileViewPrefer = 'diff' | 'file'

// What git itself looks at to call a file binary.
const SNIFF_BYTES = 8000

/**
 * A file's text as a patch where every line is kept: the diff renderer's rows,
 * wrapping and highlighting, with nothing to compare. Empty for an empty file
 * — there is no hunk to make.
 */
export function buildContextPatch(path: string, content: string): string {
  if (content === '') return ''
  const lines = content.split('\n')
  // A final newline ends the last line rather than starting another.
  if (lines.at(-1) === '') lines.pop()
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${lines.length} +1,${lines.length} @@`,
    ...lines.map((line) => ` ${line}`),
    '',
  ].join('\n')
}

function looksBinary(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.byteLength, SNIFF_BYTES)
  for (let i = 0; i < end; i++) if (bytes[i] === 0) return true
  return false
}

/** What is on disk, whatever git thinks of it. */
export async function readFileAsIs(cwd: string, path: string): Promise<FileViewContent> {
  const file = Bun.file(`${cwd}/${path}`)
  if (!(await file.exists())) return { kind: 'missing' }
  // Measured before anything is read: past the limit a read is what takes the
  // process down (see diff-limits.ts).
  const limit = diffByteLimit(path)
  if (file.size > limit) return { kind: 'too-large', limit, size: file.size }
  const bytes = await file.bytes()
  if (isPdfPath(path)) {
    return {
      diff: {
        binarySizeAfter: bytes.byteLength,
        path,
        pdfBytesAfter: bytes,
        rawDiff: '',
        status: 'pdf',
      },
      kind: 'pdf',
    }
  }
  if (isImagePath(path)) {
    return {
      diff: {
        binarySizeAfter: bytes.byteLength,
        imageBytesAfter: bytes,
        imageFormatLabel: imageFormatLabel(path),
        imageMime: imageMimeFromPath(path),
        path,
        rawDiff: '',
        status: 'image',
      },
      kind: 'image',
    }
  }
  if (bytes.byteLength === 0) return { kind: 'empty' }
  if (looksBinary(bytes)) return { kind: 'binary', size: bytes.byteLength }
  return { kind: 'text', patch: buildContextPatch(path, new TextDecoder().decode(bytes)) }
}

/**
 * A changed file against HEAD, the way git mode shows it. An untracked file has
 * nothing to be compared with — a split whose left half is empty says nothing —
 * so it is read as it is, like a file nothing has touched.
 */
export async function loadFileView(
  cwd: string,
  path: string,
  prefer: FileViewPrefer = 'diff'
): Promise<FileViewContent> {
  const change = prefer === 'diff' ? await fileChange(cwd, path) : null
  if (change !== null && change.section !== 'untracked') {
    return { diff: await fetchDiff(cwd, change), kind: 'diff' }
  }
  return readFileAsIs(cwd, path)
}

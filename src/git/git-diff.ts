import { $ } from 'bun'

import type { DiffData, DiffFileStatus, GitFileEntry } from '../state/types'

import { MAX_DIFF_BYTES } from './diff-limits'
import { imageFormatLabel, imageMimeFromPath, isImagePath } from './image-detect'

function resolveStatus(entry: GitFileEntry): { status: DiffFileStatus; oldPath?: string } {
  if (entry.renamedFrom != null && entry.renamedFrom !== '')
    return { oldPath: entry.renamedFrom, status: 'renamed' }
  if (entry.section === 'untracked' || entry.status === '?') return { status: 'new' }
  if (entry.status === 'D') return { status: 'deleted' }
  if (entry.status === 'A' && (entry.section === 'staged' || entry.section === 'historical')) {
    return { status: 'new' }
  }
  return { status: 'modified' }
}

// numstat marks a binary file by replacing both line counts with a dash.
function numstatSaysBinary(text: string): boolean {
  const first = text.trim().split('\n')[0] ?? ''
  return first.startsWith('-\t-\t')
}

async function isBinary(cwd: string, ref: string, path: string): Promise<boolean> {
  const tracked = await $`git -C ${cwd} diff ${ref} --numstat -- ${path}`.quiet().nothrow()
  if (tracked.exitCode === 0) {
    const text = tracked.text().trim()
    if (text) return numstatSaysBinary(text)
  }
  // An untracked path is absent from `git diff <ref>` altogether, so the probe above
  // comes back empty and says nothing about it. Compare against /dev/null to classify
  // it — without this, every untracked binary reads as text and gets slurped as one
  // string.
  const untracked = await $`git -C ${cwd} diff --no-index --numstat /dev/null -- ${path}`
    .quiet()
    .nothrow()
  const text = untracked.text().trim()
  if (!text) return false
  return numstatSaysBinary(text)
}

async function readHeadSize(cwd: string, ref: string, path: string): Promise<number> {
  // `cat-file -s` reads the blob header only. `git show` would materialise the entire
  // blob as a string just to measure it — the very thing MAX_DIFF_BYTES exists to stop.
  const result = await $`git -C ${cwd} cat-file -s ${ref}:${path}`.quiet().nothrow()
  if (result.exitCode !== 0) return 0
  const size = Number.parseInt(result.text().trim(), 10)
  return Number.isFinite(size) ? size : 0
}

async function readWorkingSize(cwd: string, path: string): Promise<number> {
  try {
    const file = Bun.file(`${cwd}/${path}`)
    if (await file.exists()) return file.size
  } catch {}
  return 0
}

async function readHeadBlob(
  cwd: string,
  ref: string,
  path: string
): Promise<Uint8Array | undefined> {
  // `git cat-file blob` writes raw bytes to stdout — binary-safe, unlike `git show`.
  const result = await $`git -C ${cwd} cat-file blob ${ref}:${path}`.quiet().nothrow()
  if (result.exitCode !== 0) return undefined
  const bytes = result.stdout
  return bytes.byteLength > 0 ? new Uint8Array(bytes) : undefined
}

async function readWorkingBytes(cwd: string, path: string): Promise<Uint8Array | undefined> {
  try {
    const file = Bun.file(`${cwd}/${path}`)
    if (!(await file.exists())) return undefined
    return await file.bytes()
  } catch {
    return undefined
  }
}

async function rawUnifiedDiff(
  cwd: string,
  ref: string,
  path: string,
  status: DiffFileStatus
): Promise<string> {
  if (status === 'new') {
    const result = await $`git -C ${cwd} diff ${ref} --no-color --no-textconv -- ${path}`
      .quiet()
      .nothrow()
    if (result.exitCode === 0 && result.text().length > 0) return result.text()
    const untracked =
      await $`git -C ${cwd} diff --no-index --no-color --no-textconv /dev/null -- ${path}`
        .quiet()
        .nothrow()
    return untracked.text()
  }

  const result =
    await $`git -C ${cwd} diff ${ref} --unified=99999 --no-color --no-textconv -- ${path}`
      .quiet()
      .nothrow()
  if (result.exitCode !== 0) return ''
  return result.text()
}

function resolveCompareRef(headOffset: number, compareRef: string | undefined): string {
  if (compareRef != null && compareRef !== '') return compareRef
  return headOffset > 0 ? `HEAD~${headOffset}` : 'HEAD'
}

// Both sides are measured from metadata only (blob header + stat), never by reading
// content — the sizes are what decide whether reading content is safe at all.
async function diffSizes(
  cwd: string,
  ref: string,
  path: string,
  headPath: string,
  status: DiffFileStatus
): Promise<{ after: number; before: number }> {
  const [before, after] = await Promise.all([
    status === 'new' ? Promise.resolve(0) : readHeadSize(cwd, ref, headPath),
    status === 'deleted' ? Promise.resolve(0) : readWorkingSize(cwd, path),
  ])
  return { after, before }
}

export async function fetchDiff(
  cwd: string,
  file: GitFileEntry,
  headOffset: number = 0,
  compareRef?: string
): Promise<DiffData> {
  const { oldPath, status } = resolveStatus(file)
  const ref = resolveCompareRef(headOffset, compareRef)
  const headPath = oldPath ?? file.path

  const { after: sizeAfter, before: sizeBefore } = await diffSizes(
    cwd,
    ref,
    file.path,
    headPath,
    status
  )

  // Ahead of the image branch on purpose: a multi-gigabyte .png must not be read
  // into memory either.
  if (sizeBefore > MAX_DIFF_BYTES || sizeAfter > MAX_DIFF_BYTES) {
    const data: DiffData = {
      binarySizeAfter: sizeAfter,
      binarySizeBefore: sizeBefore,
      path: file.path,
      rawDiff: '',
      status: 'too-large',
    }
    if (oldPath != null && oldPath !== '') data.oldPath = oldPath
    return data
  }

  if (isImagePath(file.path)) {
    const wantsBefore = status !== 'new'
    const wantsAfter = status !== 'deleted'
    const [imageBytesBefore, imageBytesAfter] = await Promise.all([
      wantsBefore ? readHeadBlob(cwd, ref, headPath) : Promise.resolve(undefined),
      wantsAfter ? readWorkingBytes(cwd, file.path) : Promise.resolve(undefined),
    ])
    const data: DiffData = {
      binarySizeAfter: imageBytesAfter?.byteLength ?? 0,
      binarySizeBefore: imageBytesBefore?.byteLength ?? 0,
      imageFormatLabel: imageFormatLabel(file.path),
      imageMime: imageMimeFromPath(file.path),
      path: file.path,
      rawDiff: '',
      status: 'image',
    }
    if (imageBytesBefore) data.imageBytesBefore = imageBytesBefore
    if (imageBytesAfter) data.imageBytesAfter = imageBytesAfter
    if (oldPath != null && oldPath !== '') data.oldPath = oldPath
    return data
  }

  if (await isBinary(cwd, ref, file.path)) {
    return {
      binarySizeAfter: sizeAfter,
      binarySizeBefore: sizeBefore,
      path: file.path,
      rawDiff: '',
      status: 'binary',
    }
  }

  const rawDiff = await rawUnifiedDiff(cwd, ref, file.path, status)

  const data: DiffData = {
    path: file.path,
    rawDiff,
    status,
  }
  if (oldPath != null && oldPath !== '') data.oldPath = oldPath
  return data
}

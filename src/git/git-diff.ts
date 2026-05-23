import { $ } from 'bun'

import type { DiffData, DiffFileStatus, GitFileEntry } from '../state/types'

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

async function isBinary(cwd: string, ref: string, path: string): Promise<boolean> {
  const result = await $`git -C ${cwd} diff ${ref} --numstat -- ${path}`.quiet().nothrow()
  if (result.exitCode !== 0) return false
  const text = result.text().trim()
  if (!text) return false
  const first = text.split('\n')[0] ?? ''
  return first.startsWith('-\t-\t')
}

async function readHeadSize(cwd: string, ref: string, path: string): Promise<number> {
  const result = await $`git -C ${cwd} show ${ref}:${path}`.quiet().nothrow()
  if (result.exitCode !== 0) return 0
  return result.text().length
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

export async function fetchDiff(
  cwd: string,
  file: GitFileEntry,
  headOffset: number = 0
): Promise<DiffData> {
  const { oldPath, status } = resolveStatus(file)
  const ref = headOffset > 0 ? `HEAD~${headOffset}` : 'HEAD'

  if (isImagePath(file.path)) {
    const headPath = oldPath ?? file.path
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
    const [binarySizeBefore, binarySizeAfter] = await Promise.all([
      readHeadSize(cwd, ref, file.path),
      readWorkingSize(cwd, file.path),
    ])
    return {
      binarySizeAfter,
      binarySizeBefore,
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

import { $ } from 'bun'

import type { DiffData, DiffFileStatus, GitFileEntry } from '../state/types'

function resolveStatus(entry: GitFileEntry): { status: DiffFileStatus; oldPath?: string } {
  if (entry.renamedFrom) return { oldPath: entry.renamedFrom, status: 'renamed' }
  if (entry.section === 'untracked' || entry.status === '?') return { status: 'new' }
  if (entry.status === 'D') return { status: 'deleted' }
  if (entry.status === 'A' && entry.section === 'staged') return { status: 'new' }
  return { status: 'modified' }
}

async function isBinary(cwd: string, path: string): Promise<boolean> {
  const result = await $`git -C ${cwd} diff HEAD --numstat -- ${path}`.quiet().nothrow()
  if (result.exitCode !== 0) return false
  const text = result.text().trim()
  if (!text) return false
  const first = text.split('\n')[0] ?? ''
  return first.startsWith('-\t-\t')
}

async function readHeadSize(cwd: string, path: string): Promise<number> {
  const result = await $`git -C ${cwd} show HEAD:${path}`.quiet().nothrow()
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

async function rawUnifiedDiff(cwd: string, path: string, status: DiffFileStatus): Promise<string> {
  if (status === 'new') {
    const result = await $`git -C ${cwd} diff HEAD --no-color --no-textconv -- ${path}`
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
    await $`git -C ${cwd} diff HEAD --unified=99999 --no-color --no-textconv -- ${path}`
      .quiet()
      .nothrow()
  if (result.exitCode !== 0) return ''
  return result.text()
}

export async function fetchDiff(cwd: string, file: GitFileEntry): Promise<DiffData> {
  const { oldPath, status } = resolveStatus(file)

  if (await isBinary(cwd, file.path)) {
    const [binarySizeBefore, binarySizeAfter] = await Promise.all([
      readHeadSize(cwd, file.path),
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

  const rawDiff = await rawUnifiedDiff(cwd, file.path, status)

  const data: DiffData = {
    path: file.path,
    rawDiff,
    status,
  }
  if (oldPath) data.oldPath = oldPath
  return data
}

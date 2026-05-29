import { $ } from 'bun'

import type {
  GitFileEntry,
  GitFileSection,
  GitFileStatus,
  GitPanelError,
  GitRefreshPayload,
} from '../state/types'

interface NumstatRow {
  added: number | null
  removed: number | null
}

export type GitCollectResult =
  | { kind: 'ok'; payload: GitRefreshPayload }
  | { kind: 'error'; error: GitPanelError }
  | { kind: 'out-of-range'; maxOffset: number }

const STATUS_CODES = new Set(['M', 'A', 'D', 'R', 'C', 'U', '?'])

function toStatus(char: string): GitFileStatus | null {
  return STATUS_CODES.has(char) ? (char as GitFileStatus) : null
}

export function parseBranchLines(output: string): {
  branch: string | null
  ahead: number
  behind: number
} {
  let branch: string | null = null
  let ahead = 0
  let behind = 0
  for (const line of output.split('\0')) {
    if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length).trim()
      branch = head === '(detached)' ? null : head
    } else if (line.startsWith('# branch.ab ')) {
      const rest = line.slice('# branch.ab '.length).trim()
      const match = /^\+(\d+)\s+-(\d+)/.exec(rest)
      if (match) {
        ahead = Number.parseInt(match[1] as string, 10)
        behind = Number.parseInt(match[2] as string, 10)
      }
    }
  }
  return { ahead, behind, branch }
}

export function parseNumstat(output: string): Map<string, NumstatRow> {
  const map = new Map<string, NumstatRow>()
  for (const raw of output.split('\n')) {
    if (!raw) continue
    const parts = raw.split('\t')
    if (parts.length < 3) continue
    const [addedStr, removedStr, ...pathParts] = parts
    const path = pathParts.join('\t')
    if (!path || path.includes('{') || path.includes(' => ')) continue
    const added = addedStr === '-' ? null : Number.parseInt(addedStr ?? '', 10)
    const removed = removedStr === '-' ? null : Number.parseInt(removedStr ?? '', 10)
    map.set(path, {
      added: Number.isNaN(added as number) ? null : added,
      removed: Number.isNaN(removed as number) ? null : removed,
    })
  }
  return map
}

function buildEntry(
  section: GitFileSection,
  status: GitFileStatus,
  path: string,
  numstat: Map<string, NumstatRow>,
  renamedFrom?: string
): GitFileEntry {
  const stats = numstat.get(path)
  let added: number | null
  let removed: number | null
  if (status === '?') {
    added = null
    removed = null
  } else if (stats) {
    added = stats.added
    removed = stats.removed
  } else {
    added = 0
    removed = 0
  }
  const entry: GitFileEntry = { added, path, removed, section, status }
  if (renamedFrom != null && renamedFrom !== '') entry.renamedFrom = renamedFrom
  return entry
}

export function parsePorcelainEntries(
  output: string,
  stagedNumstat: Map<string, NumstatRow>,
  unstagedNumstat: Map<string, NumstatRow>
): GitFileEntry[] {
  const files: GitFileEntry[] = []
  const records = output.split('\0')
  let i = 0
  while (i < records.length) {
    const line = records[i] ?? ''
    if (!line || line.startsWith('#') || line.startsWith('!')) {
      i++
      continue
    }

    if (line.startsWith('? ')) {
      files.push(buildEntry('untracked', '?', line.slice(2), unstagedNumstat))
      i++
      continue
    }

    if (line.startsWith('1 ')) {
      const parts = line.split(' ')
      if (parts.length >= 9) {
        const xy = parts[1] ?? '..'
        const path = parts.slice(8).join(' ')
        const x = toStatus(xy[0] ?? '.')
        const y = toStatus(xy[1] ?? '.')
        if (x) files.push(buildEntry('staged', x, path, stagedNumstat))
        if (y) files.push(buildEntry('unstaged', y, path, unstagedNumstat))
      }
      i++
      continue
    }

    if (line.startsWith('2 ')) {
      const parts = line.split(' ')
      const origPath = records[i + 1] ?? ''
      if (parts.length >= 10 && origPath) {
        const xy = parts[1] ?? '..'
        const newPath = parts.slice(9).join(' ')
        if (newPath) {
          const x = toStatus(xy[0] ?? '.')
          const y = toStatus(xy[1] ?? '.')
          if (x) files.push(buildEntry('staged', x, newPath, stagedNumstat, origPath))
          if (y) files.push(buildEntry('unstaged', y, newPath, unstagedNumstat, origPath))
        }
      }
      i += 2
      continue
    }

    if (line.startsWith('u ')) {
      const parts = line.split(' ')
      if (parts.length >= 11) {
        const path = parts.slice(10).join(' ')
        files.push(buildEntry('unstaged', 'U', path, unstagedNumstat))
      }
      i++
      continue
    }

    i++
  }
  return files
}

async function countUntrackedLines(cwd: string, path: string): Promise<number | null> {
  try {
    const file = Bun.file(`${cwd}/${path}`)
    if (!(await file.exists())) return null
    const text = await file.text()
    if (text.length === 0) return 0
    let count = 0
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) count++
    }
    if (text.charCodeAt(text.length - 1) !== 10) count++
    return count
  } catch {
    return null
  }
}

async function annotateUntrackedCounts(cwd: string, files: GitFileEntry[]): Promise<void> {
  const untracked = files.filter((f) => f.section === 'untracked')
  if (untracked.length === 0) return
  const counts = await Promise.all(untracked.map(async (f) => countUntrackedLines(cwd, f.path)))
  for (let i = 0; i < untracked.length; i++) {
    const file = untracked[i]
    const count = counts[i]
    if (file && count !== null && count !== undefined) {
      file.added = count
      file.removed = 0
    }
  }
}

interface CollectOptions {
  headOffset?: number
  // Explicit ref to diff the working tree against (e.g. a worktree's fork
  // point). Takes precedence over headOffset when set.
  compareRef?: string
}

function parseNameStatus(
  output: string
): { path: string; status: GitFileStatus; renamedFrom?: string }[] {
  const rows: { path: string; status: GitFileStatus; renamedFrom?: string }[] = []
  for (const raw of output.split('\n')) {
    if (!raw) continue
    const parts = raw.split('\t')
    const code = parts[0] ?? ''
    const letter = code[0] ?? ''
    const status = toStatus(letter)
    if (!status) continue
    if (letter === 'R' || letter === 'C') {
      const from = parts[1]
      const to = parts[2]
      if (from == null || from === '' || !(to != null && to !== '')) continue
      rows.push({ path: to, renamedFrom: from, status })
    } else {
      const path = parts.slice(1).join('\t')
      if (!path) continue
      rows.push({ path, status })
    }
  }
  return rows
}

async function collectAgainstHead(cwd: string): Promise<GitCollectResult> {
  const [statusResult, unstagedDiff, stagedDiff] = await Promise.all([
    $`git -C ${cwd} status --porcelain=v2 -b -z --untracked-files=all`.quiet().nothrow(),
    $`git -C ${cwd} -c core.quotePath=false diff --numstat`.quiet().nothrow(),
    $`git -C ${cwd} -c core.quotePath=false diff --cached --numstat`.quiet().nothrow(),
  ])

  if (statusResult.exitCode !== 0) {
    return { error: 'not-a-repo', kind: 'error' }
  }

  const statusText = statusResult.text()
  const { ahead, behind, branch } = parseBranchLines(statusText)
  const unstagedNumstat = parseNumstat(unstagedDiff.text())
  const stagedNumstat = parseNumstat(stagedDiff.text())
  const files = parsePorcelainEntries(statusText, stagedNumstat, unstagedNumstat)
  await annotateUntrackedCounts(cwd, files)

  return { kind: 'ok', payload: { ahead, behind, branch, files } }
}

async function collectAgainstHistorical(
  cwd: string,
  headOffset: number
): Promise<GitCollectResult> {
  const ref = `HEAD~${headOffset}`
  const revParse = await $`git -C ${cwd} rev-parse ${ref}`.quiet().nothrow()
  if (revParse.exitCode !== 0) {
    const countResult = await $`git -C ${cwd} rev-list --count HEAD`.quiet().nothrow()
    const count = countResult.exitCode === 0 ? Number.parseInt(countResult.text().trim(), 10) : NaN
    const maxOffset = Number.isFinite(count) && count > 0 ? count - 1 : 0
    return { kind: 'out-of-range', maxOffset }
  }
  return collectAgainstRef(cwd, ref)
}

// Diffs the working tree against an arbitrary ref (a HEAD~N commit, or a
// worktree's fork point for review-vs-base), surfacing changed files as a
// single `historical` section plus any untracked files.
async function collectAgainstRef(cwd: string, ref: string): Promise<GitCollectResult> {
  const [statusResult, nameStatus, numstat, untrackedStatus] = await Promise.all([
    $`git -C ${cwd} status --porcelain=v2 -b -z --untracked-files=all`.quiet().nothrow(),
    $`git -C ${cwd} -c core.quotePath=false diff ${ref} --name-status`.quiet().nothrow(),
    $`git -C ${cwd} -c core.quotePath=false diff ${ref} --numstat`.quiet().nothrow(),
    $`git -C ${cwd} status --porcelain=v2 -z --untracked-files=all`.quiet().nothrow(),
  ])

  if (statusResult.exitCode !== 0) {
    return { error: 'not-a-repo', kind: 'error' }
  }

  const { ahead, behind, branch } = parseBranchLines(statusResult.text())
  const stats = parseNumstat(numstat.text())
  const rows = parseNameStatus(nameStatus.text())
  const files: GitFileEntry[] = rows.map((row) =>
    buildEntry('historical', row.status, row.path, stats, row.renamedFrom)
  )

  // Untracked files live outside any commit — still surface them so `?` files
  // don't vanish when the user walks history.
  const porcelain = parsePorcelainEntries(untrackedStatus.text(), new Map(), new Map())
  const untracked = porcelain.filter((f) => f.section === 'untracked')
  await annotateUntrackedCounts(cwd, untracked)
  files.push(...untracked)

  return { kind: 'ok', payload: { ahead, behind, branch, files } }
}

export async function collectGitStatus(
  cwd: string,
  options: CollectOptions = {}
): Promise<GitCollectResult> {
  const headOffset = options.headOffset ?? 0
  const compareRef = options.compareRef
  try {
    if (compareRef != null && compareRef !== '') return await collectAgainstRef(cwd, compareRef)
    return headOffset > 0
      ? await collectAgainstHistorical(cwd, headOffset)
      : await collectAgainstHead(cwd)
  } catch {
    return { error: 'unknown', kind: 'error' }
  }
}

import { createHash } from 'node:crypto'
import { lstat, mkdir, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const DEFAULT_WORKTREE_ROOT = '/tmp/aimux-wt'
const MAX_SLUG_LENGTH = 24

export function getAimuxWorktreeRoot(): string {
  const root = process.env.AIMUX_WORKTREE_ROOT
  return root != null && root !== '' ? root : DEFAULT_WORKTREE_ROOT
}

export function sanitizePathSegment(input: string, maxLength = MAX_SLUG_LENGTH): string {
  const sanitized = input
    .trim()
    .replaceAll(/[^A-Za-z0-9._-]+/g, '-')
    .replaceAll(/\.\.+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
  return (sanitized || 'worktree').slice(0, maxLength).replaceAll(/[-_.]+$/g, '') || 'worktree'
}

function shortHash(input: string, length = 8): string {
  return createHash('sha1').update(input).digest('hex').slice(0, length)
}

export function makeWorktreePath({
  repoRoot,
  worktreeId,
  worktreeName,
}: {
  repoRoot: string
  worktreeName: string
  worktreeId: string
}): string {
  const repoKey = `r-${shortHash(resolve(repoRoot))}`
  const idSuffix = shortHash(worktreeId, 5)
  const slug = `${sanitizePathSegment(worktreeName)}-${idSuffix}`
  return join(getAimuxWorktreeRoot(), repoKey, slug)
}

export function isInsideAimuxWorktreeRoot(path: string): boolean {
  const normalizeTmp = (value: string) => value.replace(/^\/private\/tmp(?=\/|$)/, '/tmp')
  const root = `${normalizeTmp(resolve(getAimuxWorktreeRoot()))}/`
  const target = `${normalizeTmp(resolve(path))}/`
  return target.startsWith(root)
}

export async function ensureAimuxWorktreeRoot(): Promise<string> {
  const root = getAimuxWorktreeRoot()
  await mkdir(root, { recursive: true })
  const stat = await lstat(root)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`unsafe Aimux worktree root: ${root}`)
  }
  return root
}

export async function assertSafeAimuxWorktreePath(path: string): Promise<void> {
  const root = await ensureAimuxWorktreeRoot()
  if (!isInsideAimuxWorktreeRoot(path)) {
    throw new Error(`refusing worktree path outside Aimux temp root: ${path}`)
  }
  const realRoot = await realpath(root)
  const realParent = await realpath(resolve(path, '..'))
  if (`${realParent}/`.startsWith(`${realRoot}/`)) return
  throw new Error(`unsafe Aimux worktree parent: ${realParent}`)
}

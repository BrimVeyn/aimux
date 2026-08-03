import { createHash } from 'node:crypto'
import { lstat, mkdir, realpath, rmdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

// Worktrees hold uncommitted work, so they live in the XDG data dir, not /tmp:
// a reboot clears /tmp on macOS and on most Linux distros, and took the work
// with it. The old root stays recognized (never generated) so worktrees created
// before this change are still classified and deleted as aimux-managed.
const LEGACY_WORKTREE_ROOT = '/tmp/aimux-wt'
const MAX_SLUG_LENGTH = 24

function defaultWorktreeRoot(): string {
  const xdgData = process.env.XDG_DATA_HOME
  const base =
    xdgData != null && xdgData !== '' ? xdgData : join(process.env.HOME ?? '.', '.local', 'share')
  return join(base, 'aimux', 'worktrees')
}

export function getAimuxWorktreeRoot(): string {
  const root = process.env.AIMUX_WORKTREE_ROOT
  return root != null && root !== '' ? root : defaultWorktreeRoot()
}

/** `améliorer` → `ameliorer`, so accents slug as letters instead of separators. */
export function foldDiacritics(input: string): string {
  return input.normalize('NFD').replaceAll(/\p{Diacritic}/gu, '')
}

export function sanitizePathSegment(input: string, maxLength = MAX_SLUG_LENGTH): string {
  const sanitized = foldDiacritics(input)
    .trim()
    .replaceAll(/[^A-Za-z0-9._-]+/g, '-')
    .replaceAll(/\.\.+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
  return (sanitized || 'worktree').slice(0, maxLength).replaceAll(/[-_.]+$/g, '') || 'worktree'
}

function shortHash(input: string, length = 8): string {
  return createHash('sha1').update(input).digest('hex').slice(0, length)
}

// Params speak the app's vocabulary (a workspace); the directory layout keeps
// git's, so existing worktrees on disk stay exactly where they are.
export function makeWorktreePath({
  repoRoot,
  workspaceId,
  workspaceName,
}: {
  repoRoot: string
  workspaceName: string
  workspaceId: string
}): string {
  const repoKey = `r-${shortHash(resolve(repoRoot))}`
  const idSuffix = shortHash(workspaceId, 5)
  const slug = `${sanitizePathSegment(workspaceName)}-${idSuffix}`
  return join(getAimuxWorktreeRoot(), repoKey, slug)
}

export function isInsideAimuxWorktreeRoot(path: string): boolean {
  const normalizeTmp = (value: string) => value.replace(/^\/private\/tmp(?=\/|$)/, '/tmp')
  const target = `${normalizeTmp(resolve(path))}/`
  return [getAimuxWorktreeRoot(), LEGACY_WORKTREE_ROOT].some((root) =>
    target.startsWith(`${normalizeTmp(resolve(root))}/`)
  )
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

/**
 * Drop the repo-scoped `<root>/r-<hash>` parent of a removed worktree when it is
 * empty. `assertSafeAimuxWorktreePath` creates that directory before git runs,
 * so a failed or rolled-back creation used to leave one behind forever. Silent
 * on ENOTEMPTY (another worktree for the same repo is still live) and on any
 * other error — this is housekeeping, never the point of the operation.
 */
export async function pruneEmptyWorktreeParent(worktreePath: string): Promise<void> {
  if (!isInsideAimuxWorktreeRoot(worktreePath)) return
  const parent = resolve(worktreePath, '..')
  // Never touch the root itself — only the per-repo directory below it.
  if (parent === resolve(getAimuxWorktreeRoot())) return
  if (!isInsideAimuxWorktreeRoot(parent)) return
  try {
    await rmdir(parent)
  } catch {
    // Non-empty (a sibling worktree is live) or already gone. Either is fine.
  }
}

export async function assertSafeAimuxWorktreePath(path: string): Promise<void> {
  const root = await ensureAimuxWorktreeRoot()
  if (!isInsideAimuxWorktreeRoot(path)) {
    throw new Error(`refusing worktree path outside Aimux worktree root: ${path}`)
  }
  // Create the repo-scoped parent (<root>/r-<hash>) before resolving it: git
  // worktree add does not create intermediate dirs, and realpath() would throw
  // ENOENT on the first worktree for a repo. mkdir(recursive) leaves an
  // existing symlink in place, so the realpath check below still catches an
  // escape out of the worktree root.
  const parent = resolve(path, '..')
  await mkdir(parent, { recursive: true })
  const realRoot = await realpath(root)
  const realParent = await realpath(parent)
  if (`${realParent}/`.startsWith(`${realRoot}/`)) return
  throw new Error(`unsafe Aimux worktree parent: ${realParent}`)
}

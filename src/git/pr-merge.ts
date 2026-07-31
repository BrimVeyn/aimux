import { logDebug } from '../debug/input-log'
import { runCli } from '../services/ai-usage/spawn'

export interface RepoMergeMethods {
  mergeCommitAllowed: boolean
  squashMergeAllowed: boolean
  rebaseMergeAllowed: boolean
}

/**
 * Mirrors the method GitHub pre-selects on the merge button: a merge commit
 * when the repo allows one, then squash, then rebase. `gh pr merge` refuses to
 * guess when several are enabled, so we have to name one explicitly.
 */
export function pickMergeFlag(methods: RepoMergeMethods): string | null {
  if (methods.mergeCommitAllowed) return '--merge'
  if (methods.squashMergeAllowed) return '--squash'
  if (methods.rebaseMergeAllowed) return '--rebase'
  return null
}

export type MergeResult = { ok: true } | { ok: false; message: string }

async function repoMergeMethods(gh: string, cwd: string): Promise<RepoMergeMethods | null> {
  const result = await runCli(
    gh,
    ['repo', 'view', '--json', 'mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed'],
    15_000,
    cwd
  )
  if (!result.ok) return null
  try {
    const raw = JSON.parse(result.stdout) as Record<string, unknown>
    return {
      mergeCommitAllowed: raw.mergeCommitAllowed === true,
      rebaseMergeAllowed: raw.rebaseMergeAllowed === true,
      squashMergeAllowed: raw.squashMergeAllowed === true,
    }
  } catch {
    return null
  }
}

export async function approveAndMergePr(cwd: string): Promise<MergeResult> {
  const gh = Bun.which('gh')
  if (gh === null) return { message: 'gh CLI not found', ok: false }

  const methods = await repoMergeMethods(gh, cwd)
  if (methods === null) return { message: 'could not read repo merge settings', ok: false }
  const flag = pickMergeFlag(methods)
  if (flag === null) return { message: 'repo allows no merge method', ok: false }

  // GitHub rejects approving your own PR, and a missing approval is not a
  // reason to skip the merge — best effort, log it, move on.
  const approve = await runCli(gh, ['pr', 'review', '--approve'], 15_000, cwd)
  if (!approve.ok) logDebug('git.pr.approveSkipped', { error: approve.error })

  const merge = await runCli(gh, ['pr', 'merge', flag], 60_000, cwd)
  if (!merge.ok) {
    const detail = merge.stderr.trim().split('\n')[0] ?? 'merge failed'
    return { message: detail.slice(0, 160), ok: false }
  }
  return { ok: true }
}

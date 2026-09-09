import { type DaemonPluginContext, definePlugin } from '@brimveyn/aimux-plugin'

import {
  type Commit,
  type Failure,
  LOG_FORMAT,
  type LogResult,
  parseLog,
  type ShowResult,
} from './parse'

/**
 * git lives on this side for one reason: the UI half cannot know where the
 * repository is. `PluginUiState` carries a `projectId` and nothing else about
 * the filesystem, while the daemon has `ctx.projects` — and for a worktree the
 * directory to run in (`path`) and the repository it belongs to (`repoRoot`)
 * are different paths, which is a distinction only this side can make.
 *
 * Failures come back as `{ error }` rather than a rejection. A view that draws
 * one line saying what git said is worth more than a view that is empty and a
 * message in a log the user is not reading.
 */

async function run(argv: string[], cwd: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(argv, { cwd, stderr: 'ignore', stdout: 'pipe' })
    const [text, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    return exitCode === 0 ? text : null
  } catch {
    // `git` not on PATH, or a directory that has gone away under a worktree.
    return null
  }
}

/**
 * The repository behind the project the user is looking at.
 *
 * `repoRoot` first: in an aimux worktree the workspace path is the worktree and
 * the history is the repository's, which is the whole point of the field.
 */
function repoOf(ctx: DaemonPluginContext, payload: unknown): string | null {
  const projectId = (payload as { projectId?: string } | null)?.projectId
  if (typeof projectId !== 'string' || projectId === '') return null
  const project = ctx.projects.get(projectId)
  if (project === undefined) return null
  const workspace = project.workspaces.find(
    (candidate) => candidate.id === project.activeWorkspaceId
  )
  return workspace?.repoRoot ?? workspace?.path ?? project.path ?? null
}

function number(value: unknown, fallback: number, min: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.trunc(value))
    : fallback
}

export default definePlugin({
  apply(context) {
    const ctx = context as DaemonPluginContext
    const count = number(ctx.config.count, 200, 1)
    const maxLines = number(ctx.config.maxLines, 500, 1)
    const showMerges = ctx.config.showMerges !== false

    ctx.rpc.handle('log', async (payload): Promise<Failure | LogResult> => {
      const repoRoot = repoOf(ctx, payload)
      if (repoRoot === null) return { error: 'no project open — nothing to read a log from' }

      const stdout = await run(
        [
          'git',
          'log',
          `-n${count}`,
          ...(showMerges ? [] : ['--no-merges']),
          `--pretty=format:${LOG_FORMAT}`,
        ],
        repoRoot
      )
      if (stdout === null) return { error: `git log failed in ${repoRoot}` }

      const commits: Commit[] = parseLog(stdout)
      const branch = (await run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], repoRoot))?.trim()
      ctx.log.info('read the log', { commits: commits.length, repoRoot })
      return { branch: branch === undefined || branch === '' ? null : branch, commits, repoRoot }
    })

    ctx.rpc.handle('show', async (payload): Promise<Failure | ShowResult> => {
      const { sha } = (payload ?? {}) as { sha?: string }
      // Argv, not a shell string, so there is nothing to inject into — but a
      // sha is still checked, because `git show` takes revision syntax and a
      // typo that resolves to something else is a confusing screen.
      if (typeof sha !== 'string' || !/^[0-9a-f]{7,40}$/.test(sha))
        return { error: 'not a commit id' }
      const repoRoot = repoOf(ctx, payload)
      if (repoRoot === null) return { error: 'no project open' }

      // `--stat` on its own is the stat and nothing else: the body and one
      // line per file. The hunks are git mode's job, and `--patch` here would
      // be a worse copy of a screen aimux already has.
      const stdout = await run(
        ['git', 'show', '--no-color', '--stat', '--format=%b', sha],
        repoRoot
      )
      if (stdout === null) return { error: `git show ${sha} failed` }

      const lines = stdout.split('\n')
      return {
        sha,
        text: lines.slice(0, maxLines).join('\n'),
        truncated: lines.length > maxLines,
      }
    })
  },
})

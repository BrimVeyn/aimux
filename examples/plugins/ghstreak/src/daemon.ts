import { type DaemonPluginContext, definePlugin } from '@brimveyn/aimux-plugin'

import { type Calendar, EMPTY_CALENDAR } from './calendar'

/**
 * Two sources for the same shape, tried in order: the signed-in GitHub account
 * through `gh`, then the repository the user is actually in through `git log`.
 *
 * The fallback is the point. A plugin whose only source needs a tool that may
 * not be installed is a plugin that shows an error box to most people; one that
 * degrades to what is definitely there shows a grid to everyone, and says which
 * grid it is showing.
 */

const GRAPHQL = `query {
  viewer {
    login
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
}`

interface GhResponse {
  data?: {
    viewer?: {
      login?: string
      contributionsCollection?: {
        contributionCalendar?: {
          totalContributions?: number
          weeks?: { contributionDays?: { date?: string; contributionCount?: number }[] }[]
        }
      }
    }
  }
}

async function run(argv: string[], cwd?: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(argv, {
      ...(cwd === undefined ? {} : { cwd }),
      stderr: 'ignore',
      stdout: 'pipe',
    })
    const [text, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    return exitCode === 0 ? text : null
  } catch {
    // `gh` or `git` not on PATH. The caller falls through to the next source.
    return null
  }
}

async function fromGithub(): Promise<Calendar | null> {
  const raw = await run(['gh', 'api', 'graphql', '-f', `query=${GRAPHQL}`])
  if (raw === null) return null

  let parsed: GhResponse
  try {
    parsed = JSON.parse(raw) as GhResponse
  } catch {
    return null
  }

  const viewer = parsed.data?.viewer
  const calendar = viewer?.contributionsCollection?.contributionCalendar
  if (!calendar?.weeks) return null

  const counts: Record<string, number> = {}
  for (const week of calendar.weeks) {
    for (const day of week.contributionDays ?? []) {
      if (
        day.date !== undefined &&
        day.contributionCount !== undefined &&
        day.contributionCount > 0
      ) {
        counts[day.date] = day.contributionCount
      }
    }
  }
  return {
    counts,
    label: viewer?.login ?? 'github',
    source: 'gh',
    total: calendar.totalContributions ?? 0,
  }
}

async function fromGit(repoRoot: string, label: string): Promise<Calendar | null> {
  const raw = await run(
    ['git', 'log', '--since=1.year', '--date=short', '--pretty=format:%ad'],
    repoRoot
  )
  if (raw === null) return null

  const counts: Record<string, number> = {}
  let total = 0
  for (const line of raw.split('\n')) {
    const day = line.trim()
    if (day === '') continue
    counts[day] = (counts[day] ?? 0) + 1
    total += 1
  }
  return { counts, label, source: 'git', total }
}

export default definePlugin({
  apply(context) {
    const ctx = context as DaemonPluginContext
    const preferGithub = ctx.config.preferGithub !== false

    ctx.rpc.handle('calendar', async (payload) => {
      const { projectId } = payload as { projectId: string | null }

      if (preferGithub) {
        const github = await fromGithub()
        if (github !== null) return github
      }

      // `path` and `repoRoot` differ for a worktree, and `git log` wants the
      // repository — which is exactly why `ctx.workspaces` hands over both.
      const project = projectId === null ? undefined : ctx.projects.get(projectId)
      const workspace =
        project?.workspaces.find((entry) => entry.id === project.activeWorkspaceId) ??
        project?.workspaces[0]
      if (workspace === undefined) return EMPTY_CALENDAR

      return (await fromGit(workspace.repoRoot, project?.name ?? workspace.name)) ?? EMPTY_CALENDAR
    })
  },
})

import type { CliCommand } from '../../registry'

import { listGitWorktrees } from '../../../git/worktree'
import { IPC_CAPABILITY_LIST_TABS } from '../../../ipc/protocol'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'

export const worktreeList: CliCommand = {
  args: [],
  flags: SHARED_FLAGS,
  group: 'worktree',
  run: async (ctx) => {
    const project = ctx.getProject()
    const records = project.worktrees ?? []

    // Count live tabs per worktree so an orchestrator can see co-location
    // (several workers sharing one worktree) at a glance. Best-effort: `null`
    // when the daemon is unreachable or predates the listTabs capability —
    // `worktree list` otherwise reads purely from the catalog + git, so we don't
    // want a down daemon to fail it.
    const tabCounts = new Map<string, number>()
    let tabCountsAvailable = false
    try {
      const daemon = await ctx.getDaemon()
      if (daemon.hasCapability(IPC_CAPABILITY_LIST_TABS)) {
        const { tabs } = await daemon.listTabs(project.id)
        for (const tab of tabs) {
          if (tab.worktreeId != null) {
            tabCounts.set(tab.worktreeId, (tabCounts.get(tab.worktreeId) ?? 0) + 1)
          }
        }
        tabCountsAvailable = true
      }
    } catch {
      // daemon unreachable — leave tabCount null rather than failing the list.
    }

    // Cross-check against git so we can flag catalog entries that git no
    // longer knows about (prunable / vanished) — otherwise the CLI would
    // happily report worktrees that don't exist on disk.
    const primary = records.find((w) => w.source === 'primary')
    const gitPaths = new Set<string>()
    if (primary) {
      for (const w of await listGitWorktrees(primary.repoRoot)) {
        if (w.prunable !== true) gitPaths.add(w.path)
      }
    }

    writeJson({
      activeWorktreeId: project.activeWorktreeId ?? null,
      projectId: project.id,
      worktrees: records.map((w) => ({
        branch: w.branch,
        createdByAimux: w.createdByAimux,
        gitTracked: primary ? gitPaths.has(w.path) : null,
        id: w.id,
        name: w.name,
        path: w.path,
        repoRoot: w.repoRoot,
        source: w.source,
        tabCount: tabCountsAvailable ? (tabCounts.get(w.id) ?? 0) : null,
      })),
    })
    return EXIT_OK
  },
  summary: 'List worktrees for a project',
  verb: 'list',
}

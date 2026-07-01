import type { CliCommand } from '../../registry'

import { listGitWorktrees } from '../../../git/worktree'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'

export const worktreeList: CliCommand = {
  args: [],
  flags: SHARED_FLAGS,
  group: 'worktree',
  run: async (ctx) => {
    const workspace = ctx.getWorkspace()
    const records = workspace.worktrees ?? []

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
      activeWorktreeId: workspace.activeWorktreeId ?? null,
      workspaceId: workspace.id,
      worktrees: records.map((w) => ({
        branch: w.branch,
        createdByAimux: w.createdByAimux,
        gitTracked: primary ? gitPaths.has(w.path) : null,
        id: w.id,
        name: w.name,
        path: w.path,
        repoRoot: w.repoRoot,
        source: w.source,
      })),
    })
    return EXIT_OK
  },
  summary: 'List worktrees for a workspace',
  verb: 'list',
}

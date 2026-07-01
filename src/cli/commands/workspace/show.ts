import type { CliCommand } from '../../registry'

import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'

export const workspaceShow: CliCommand = {
  args: [],
  flags: SHARED_FLAGS,
  group: 'workspace',
  run: async (ctx) => {
    const workspace = ctx.getWorkspace()
    writeJson({
      activeWorktreeId: workspace.activeWorktreeId,
      createdAt: workspace.createdAt,
      id: workspace.id,
      lastOpenedAt: workspace.lastOpenedAt,
      name: workspace.name,
      projectPath: workspace.projectPath,
      worktrees:
        workspace.worktrees?.map((w) => ({
          branch: w.branch,
          id: w.id,
          name: w.name,
          path: w.path,
          source: w.source,
        })) ?? [],
    })
    return EXIT_OK
  },
  summary: 'Show the active workspace (or the one named via --workspace)',
  verb: 'show',
}

import type { CliCommand } from '../../registry'

import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'

export const projectShow: CliCommand = {
  args: [],
  flags: SHARED_FLAGS,
  group: 'project',
  run: async (ctx) => {
    const project = ctx.getProject()
    writeJson({
      activeWorktreeId: project.activeWorktreeId,
      createdAt: project.createdAt,
      id: project.id,
      lastOpenedAt: project.lastOpenedAt,
      name: project.name,
      projectPath: project.projectPath,
      worktrees:
        project.worktrees?.map((w) => ({
          branch: w.branch,
          id: w.id,
          name: w.name,
          path: w.path,
          source: w.source,
        })) ?? [],
    })
    return EXIT_OK
  },
  summary: 'Show the active project (or the one named via --project)',
  verb: 'show',
}

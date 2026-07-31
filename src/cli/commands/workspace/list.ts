import type { CliCommand } from '../../registry'

import { listWorkspaces } from '../../client/workspace-resolver'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'

export const workspaceList: CliCommand = {
  args: [],
  flags: SHARED_FLAGS,
  group: 'workspace',
  run: async () => {
    const projects = listWorkspaces()
    writeJson({
      workspaces: projects.map((project) => ({
        id: project.id,
        lastOpenedAt: project.lastOpenedAt,
        name: project.name,
        projectPath: project.projectPath,
      })),
    })
    return EXIT_OK
  },
  summary: 'List known workspaces (projects) in the profile catalog',
  verb: 'list',
}

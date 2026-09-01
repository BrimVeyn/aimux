import type { CliCommand } from '../../registry'

import { listProjects } from '../../client/project-resolver'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'

export const projectList: CliCommand = {
  args: [],
  flags: SHARED_FLAGS,
  group: 'project',
  run: async () => {
    const projects = listProjects()
    writeJson({
      projects: projects.map((project) => ({
        id: project.id,
        lastOpenedAt: project.lastOpenedAt,
        name: project.name,
        projectPath: project.projectPath,
      })),
    })
    return EXIT_OK
  },
  summary: 'List known projects in the profile catalog',
  verb: 'list',
}

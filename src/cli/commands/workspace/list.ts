import type { CliCommand } from '../../registry'

import { listWorkspaces } from '../../client/workspace-resolver'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'

export const workspaceList: CliCommand = {
  args: [],
  flags: SHARED_FLAGS,
  group: 'workspace',
  run: async () => {
    const sessions = listWorkspaces()
    writeJson({
      workspaces: sessions.map((session) => ({
        id: session.id,
        lastOpenedAt: session.lastOpenedAt,
        name: session.name,
        projectPath: session.projectPath,
      })),
    })
    return EXIT_OK
  },
  summary: 'List known workspaces (sessions) in the profile catalog',
  verb: 'list',
}

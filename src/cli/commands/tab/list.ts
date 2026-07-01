import type { CliCommand } from '../../registry'

import { IPC_CAPABILITY_LIST_TABS, IPC_CAPABILITY_THIN_ATTACH } from '../../../ipc/protocol'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'

export const tabList: CliCommand = {
  args: [],
  flags: SHARED_FLAGS,
  group: 'tab',
  run: async (ctx) => {
    const workspace = ctx.getWorkspace()
    const daemon = await ctx.getDaemon()

    if (daemon.hasCapability(IPC_CAPABILITY_LIST_TABS)) {
      const result = await daemon.listTabs(workspace.id)
      writeJson({ activeTabId: result.activeTabId, tabs: result.tabs })
      return EXIT_OK
    }

    if (!daemon.hasCapability(IPC_CAPABILITY_THIN_ATTACH)) {
      throw new Error(
        'daemon predates listTabs and thinAttach capabilities — restart aimux to pick up the new daemon'
      )
    }

    // Fallback: thin-attach to read the same information without resizing the
    // session. Pre-listTabs daemons that advertise thinAttach would in
    // principle land here, but that combination shouldn't ship.
    const attach = await daemon.attach({
      cols: 0,
      rows: 0,
      sessionId: workspace.id,
      thin: true,
    })
    writeJson({
      activeTabId: attach.activeTabId,
      tabs: attach.tabs.map((tab) => ({
        activity: tab.activity,
        assistant: tab.assistant,
        command: tab.command,
        id: tab.id,
        status: tab.status,
        title: tab.title,
        worktreeId: tab.worktreeId,
      })),
    })
    return EXIT_OK
  },
  summary: 'List tabs in the active workspace',
  verb: 'list',
}

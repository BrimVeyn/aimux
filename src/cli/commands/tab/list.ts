import type { CliCommand } from '../../registry'

import {
  IPC_CAPABILITY_LIST_TABS,
  IPC_CAPABILITY_LIST_TABS_LAST_LINE,
  IPC_CAPABILITY_THIN_ATTACH,
  type TabSessionSummary,
} from '../../../ipc/protocol'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, writeJson } from '../../output'

/**
 * The daemon always populates `lastLine` on `listTabs` summaries (it's cheap),
 * but the field bloats the common poll, so we strip it unless `--verbose` was
 * asked for. Keeping the default output byte-identical to pre-v13 avoids
 * churning downstream consumers.
 */
function stripLastLine(tab: TabSessionSummary): TabSessionSummary {
  const { lastLine: _lastLine, ...rest } = tab
  return rest
}

export const tabList: CliCommand = {
  args: [],
  flags: [
    ...SHARED_FLAGS,
    {
      description: "include each tab's last non-blank rendered line",
      kind: 'boolean',
      name: 'verbose',
    },
  ],
  group: 'tab',
  run: async (ctx) => {
    const project = ctx.getProject()
    const daemon = await ctx.getDaemon()
    const verbose = ctx.args.flags.verbose === true

    if (verbose && !daemon.hasCapability(IPC_CAPABILITY_LIST_TABS_LAST_LINE)) {
      throw new Error(
        'daemon predates tab list --verbose (listTabsLastLine) — restart aimux to pick up the new daemon'
      )
    }

    if (daemon.hasCapability(IPC_CAPABILITY_LIST_TABS)) {
      const result = await daemon.listTabs(project.id)
      const tabs = verbose ? result.tabs : result.tabs.map(stripLastLine)
      writeJson({ activeTabId: result.activeTabId, tabs })
      return EXIT_OK
    }

    if (!daemon.hasCapability(IPC_CAPABILITY_THIN_ATTACH)) {
      throw new Error(
        'daemon predates listTabs and thinAttach capabilities — restart aimux to pick up the new daemon'
      )
    }

    // Fallback: thin-attach to read the same information without resizing the
    // project. Pre-listTabs daemons that advertise thinAttach would in
    // principle land here, but that combination shouldn't ship.
    const attach = await daemon.attach({
      cols: 0,
      projectId: project.id,
      rows: 0,
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
        workspaceId: tab.workspaceId,
      })),
    })
    return EXIT_OK
  },
  summary: 'List tabs in the active project',
  verb: 'list',
}

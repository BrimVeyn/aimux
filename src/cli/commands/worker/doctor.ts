import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { CliCommand } from '../../registry'

import { loadConfig } from '../../../config'
import { MANAGER_CAPABILITY_WORKER_METADATA } from '../../../ipc/manager-protocol'
import {
  IPC_CAPABILITY_LIST_TABS,
  IPC_CAPABILITY_QUESTION_EVENTS,
  IPC_CAPABILITY_THIN_ATTACH,
  IPC_CAPABILITY_TURN_LIFECYCLE,
  IPC_CAPABILITY_WORKER_METADATA,
  IPC_CAPABILITY_WORKTREE_LIFECYCLE_EVENTS,
} from '../../../ipc/protocol'
import {
  getAllAssistantOptions,
  isCommandAvailable,
  parseCommand,
} from '../../../pty/command-registry'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, EXIT_RUNTIME, writeJson } from '../../output'
import { WORKER_SCHEMA_VERSION } from './shared'

const REQUIRED_DAEMON_CAPABILITIES = [
  IPC_CAPABILITY_LIST_TABS,
  IPC_CAPABILITY_QUESTION_EVENTS,
  IPC_CAPABILITY_THIN_ATTACH,
  IPC_CAPABILITY_TURN_LIFECYCLE,
  IPC_CAPABILITY_WORKER_METADATA,
  IPC_CAPABILITY_WORKTREE_LIFECYCLE_EVENTS,
] as const

export const workerDoctor: CliCommand = {
  args: [],
  flags: SHARED_FLAGS,
  group: 'worker',
  run: async (ctx) => {
    const daemon = await ctx.getDaemon()
    const workspace = ctx.getWorkspace()
    const { version } = await import('../../../../package.json')
    const { customCommands } = loadConfig()
    const assistants = getAllAssistantOptions(customCommands).map((assistant) => ({
      available: isCommandAvailable(
        parseCommand(customCommands[assistant.id] ?? assistant.command).executable
      ),
      id: assistant.id,
      supportsEffort: assistant.model?.buildEffortArgs !== undefined,
      supportsModel: assistant.model?.buildModelArgs !== undefined,
    }))
    const daemonCapabilities = daemon.getCapabilities()
    const managerCapabilities = daemon.getManagerCapabilities()
    const missingDaemonCapabilities = REQUIRED_DAEMON_CAPABILITIES.filter(
      (capability) => !daemonCapabilities.includes(capability)
    )
    const missingManagerCapabilities = [MANAGER_CAPABILITY_WORKER_METADATA].filter(
      (capability) => !managerCapabilities.includes(capability)
    )
    const primaryWorktree = workspace.worktrees?.find((worktree) => worktree.source === 'primary')
    const availableAssistants = assistants.filter((assistant) => assistant.available)
    const skillPath = fileURLToPath(
      new URL('../../../../skills/aimux-orchestrator/', import.meta.url)
    )
    const issues: string[] = []
    if (missingDaemonCapabilities.length > 0) {
      issues.push(
        `restart or update aimux; daemon is missing: ${missingDaemonCapabilities.join(', ')}`
      )
    }
    if (missingManagerCapabilities.length > 0) {
      issues.push(
        `restart the terminal manager; it is missing: ${missingManagerCapabilities.join(', ')}`
      )
    }
    if (primaryWorktree === undefined) {
      issues.push('workspace has no primary worktree; default isolated worker runs are unavailable')
    }
    if (availableAssistants.length === 0) {
      issues.push('no configured assistant executable is available on PATH')
    }
    if (!existsSync(skillPath)) {
      issues.push(`packaged orchestrator skill is missing: ${skillPath}`)
    }
    const ready = issues.length === 0
    writeJson({
      assistants,
      checks: {
        assistants: {
          available: availableAssistants.map((assistant) => assistant.id),
          ok: availableAssistants.length > 0,
        },
        daemonCapabilities: {
          missing: missingDaemonCapabilities,
          ok: missingDaemonCapabilities.length === 0,
        },
        managerCapabilities: {
          missing: missingManagerCapabilities,
          ok: missingManagerCapabilities.length === 0,
        },
        skill: { ok: existsSync(skillPath), path: skillPath },
        workspace: {
          hasPrimaryWorktree: primaryWorktree !== undefined,
          ok: primaryWorktree !== undefined,
        },
      },
      cliVersion: version,
      daemon: {
        appVersion: daemon.getAppVersion(),
        capabilities: daemonCapabilities,
        managerCapabilities,
        managerProtocolVersion: daemon.getManagerSelectedVersion(),
        processVersion: daemon.getProcessVersion(),
        protocolVersion: daemon.getSelectedVersion(),
      },
      issues,
      ready,
      schemaVersion: WORKER_SCHEMA_VERSION,
      skillPath,
      workspace: {
        id: workspace.id,
        name: workspace.name,
        projectPath: workspace.projectPath ?? null,
      },
    })
    return ready ? EXIT_OK : EXIT_RUNTIME
  },
  summary: 'Check worker prerequisites, versions, assistants, and workspace',
  verb: 'doctor',
}

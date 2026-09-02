import { existsSync } from 'node:fs'

import type { CliCommand } from '../../registry'

import { loadConfig } from '../../../config'
import { MANAGER_CAPABILITY_WORKER_METADATA } from '../../../ipc/manager-protocol'
import {
  IPC_CAPABILITY_LIST_TABS,
  IPC_CAPABILITY_QUESTION_EVENTS,
  IPC_CAPABILITY_THIN_ATTACH,
  IPC_CAPABILITY_TURN_LIFECYCLE,
  IPC_CAPABILITY_WORKER_METADATA,
  IPC_CAPABILITY_WORKSPACE_LIFECYCLE_EVENTS,
} from '../../../ipc/protocol'
import {
  getAllAssistantOptions,
  isCommandAvailable,
  parseCommand,
} from '../../../pty/command-registry'
import { skillPath as resolveSkillPath } from '../../../skills'
import {
  findPrimaryWorkspace,
  PROJECT_ENV_VAR,
  projectRepoRoot,
} from '../../client/project-resolver'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, EXIT_RUNTIME, writeJson } from '../../output'
import { WORKER_SCHEMA_VERSION } from './shared'

const REQUIRED_DAEMON_CAPABILITIES = [
  IPC_CAPABILITY_LIST_TABS,
  IPC_CAPABILITY_QUESTION_EVENTS,
  IPC_CAPABILITY_THIN_ATTACH,
  IPC_CAPABILITY_TURN_LIFECYCLE,
  IPC_CAPABILITY_WORKER_METADATA,
  IPC_CAPABILITY_WORKSPACE_LIFECYCLE_EVENTS,
] as const

export const workerDoctor: CliCommand = {
  args: [],
  flags: SHARED_FLAGS,
  group: 'worker',
  run: async (ctx) => {
    const daemon = await ctx.getDaemon()
    const project = ctx.getProject()
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
    const primaryWorkspace = findPrimaryWorkspace(project)
    const projectOrigin = ctx.getProjectOrigin?.() ?? 'active'
    const availableAssistants = assistants.filter((assistant) => assistant.available)
    const skillPath = resolveSkillPath('aimux-orchestrator')
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
    if (primaryWorkspace === undefined) {
      issues.push('project has no primary workspace; default isolated worker runs are unavailable')
    }
    if (availableAssistants.length === 0) {
      issues.push('no configured assistant executable is available on PATH')
    }
    if (!existsSync(skillPath)) {
      issues.push(`packaged orchestrator skill is missing: ${skillPath}`)
    }
    // Not an issue — an inferred project is the normal interactive case — but
    // it IS the one resolution mode that can follow the UI to another project
    // between two calls. An orchestrator dispatching a multi-hour fleet wants to
    // see this before it starts, not after it reviews diffs from the wrong repo.
    const warnings: string[] = []
    if (projectOrigin === 'active') {
      warnings.push(
        `project "${project.name}" was inferred from the most recently opened project and follows the UI; pin it with --project or ${PROJECT_ENV_VAR}`
      )
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
        project: {
          hasPrimaryWorkspace: primaryWorkspace !== undefined,
          name: project.name,
          ok: primaryWorkspace !== undefined,
          /** Repo every fresh worker workspace is cut from — confirm before dispatching. */
          repoRoot: projectRepoRoot(project),
          /** 'flag' | 'env' | 'active'; only 'active' can follow the UI. */
          source: projectOrigin,
        },
        skill: { ok: existsSync(skillPath), path: skillPath },
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
      project: {
        id: project.id,
        name: project.name,
        projectPath: project.projectPath ?? null,
        repoRoot: projectRepoRoot(project),
        source: projectOrigin,
      },
      ready,
      schemaVersion: WORKER_SCHEMA_VERSION,
      skillPath,
      warnings,
    })
    return ready ? EXIT_OK : EXIT_RUNTIME
  },
  summary: 'Check worker prerequisites, versions, assistants, and project',
  verb: 'doctor',
}

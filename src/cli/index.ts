import type { DaemonClient } from './client/daemon-client'
import type { CliContext } from './context'

import { connectToDaemon } from './client/bootstrap'
import { resolveWorkspace } from './client/workspace-resolver'
import { CliUsageError, parseArgs } from './flags'
import {
  EXIT_DAEMON_UNREACHABLE,
  EXIT_OK,
  EXIT_RUNTIME,
  EXIT_USAGE,
  writeError,
  writeJson,
} from './output'
import { COMMANDS, resolveCommand } from './registry'

function printHelp(): void {
  process.stdout.write(
    'aimux CLI control plane\n\nUsage:\n  aimux <group> <verb> [flags] [args]\n\n'
  )
  const byGroup = new Map<string, typeof COMMANDS>()
  for (const command of COMMANDS) {
    const existing = byGroup.get(command.group) ?? []
    byGroup.set(command.group, [...existing, command] as typeof COMMANDS)
  }
  for (const [group, commands] of byGroup) {
    process.stdout.write(`  ${group}\n`)
    for (const command of commands) {
      process.stdout.write(`    aimux ${group} ${command.verb.padEnd(10)} ${command.summary}\n`)
    }
    process.stdout.write('\n')
  }
}

export async function runCli(argv: readonly string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printHelp()
    return EXIT_OK
  }

  const group = argv[0] ?? ''
  const verb = argv[1] ?? ''
  const command = resolveCommand(group, verb)
  if (!command) {
    writeError(`unknown command: ${group} ${verb}`)
    printHelp()
    return EXIT_USAGE
  }

  let parsed
  try {
    parsed = parseArgs(argv.slice(2), command.flags, command.args)
  } catch (error) {
    if (error instanceof CliUsageError) {
      writeError(error.message)
      writeError(`usage: aimux ${command.group} ${command.verb}`)
      return EXIT_USAGE
    }
    throw error
  }

  // --profile overrides the env var BEFORE anyone touches a runtime path —
  // the daemon socket path, catalog path, and TM socket path all derive from
  // it. After this point all `getIpcDaemonSocketPath()` reads pick it up.
  if (typeof parsed.flags.profile === 'string' && parsed.flags.profile !== '') {
    process.env.AIMUX_PROFILE = parsed.flags.profile
  }

  const state: {
    daemon: DaemonClient | null
    workspace: ReturnType<typeof resolveWorkspace> | null
  } = {
    daemon: null,
    workspace: null,
  }
  const ctx: CliContext = {
    args: parsed,
    getDaemon: async () => {
      if (state.daemon) return state.daemon
      state.daemon = await connectToDaemon()
      return state.daemon
    },
    getWorkspace: () => {
      if (state.workspace) return state.workspace
      const workspaceFlag =
        typeof parsed.flags.workspace === 'string' ? parsed.flags.workspace : undefined
      state.workspace = resolveWorkspace(workspaceFlag)
      return state.workspace
    },
  }

  try {
    const code = await command.run(ctx)
    return code
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/daemon|socket|unreachable|ECONNREFUSED/i.test(message)) {
      writeError(message)
      writeJson({ error: message, kind: 'daemon-unreachable' })
      return EXIT_DAEMON_UNREACHABLE
    }
    writeError(message)
    writeJson({ error: message, kind: 'runtime-error' })
    return EXIT_RUNTIME
  } finally {
    state.daemon?.close()
  }
}

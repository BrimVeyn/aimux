import type { DaemonClient } from './client/daemon-client'
import type { CliContext } from './context'

import { connectToDaemon, DaemonUnreachableError } from './client/bootstrap'
import { listProjects, resolveProjectWithOrigin } from './client/project-resolver'
import { type ArgSpec, CliUsageError, type FlagSpec, parseArgs, SHARED_FLAGS } from './flags'
import {
  EXIT_DAEMON_UNREACHABLE,
  EXIT_OK,
  EXIT_RUNTIME,
  EXIT_USAGE,
  writeError,
  writeJson,
} from './output'
import { type CliCommand, COMMANDS, resolveCommand } from './registry'

const EXIT_CODES_BLOCK = [
  'Exit codes:',
  '  0    success',
  '  2    usage error (bad flags, unknown command, missing argument)',
  '  3    runtime error (server replied with error, command failed)',
  '  4    daemon unreachable (socket missing and autostart failed)',
  '  10   question (tab run / tab await: worker is blocked on a question/permission)',
  '  11   pending submit (worker holds an unsubmitted prompt — see `worker submit`)',
  '  124  timeout (tab run, tab await, tab wait, tab tail --timeout, project switch --wait)',
].join('\n')

const OUTPUT_CONTRACT_BLOCK = [
  'Output contract:',
  '  stdout  one JSON object per command (NDJSON for `tab tail`, `tab wait`)',
  '  stderr  human-readable error lines, prefixed with `aimux:`',
].join('\n')

function groupByCommand(commands: readonly CliCommand[]): Map<string, CliCommand[]> {
  const byGroup = new Map<string, CliCommand[]>()
  for (const command of commands) {
    const existing = byGroup.get(command.group) ?? []
    existing.push(command)
    byGroup.set(command.group, existing)
  }
  return byGroup
}

function isSharedFlag(name: string): boolean {
  return SHARED_FLAGS.some((f) => f.name === name)
}

function formatArgs(args: readonly ArgSpec[]): string {
  if (args.length === 0) return ''
  return args.map((a) => (a.required === true ? `<${a.name}>` : `[${a.name}]`)).join(' ')
}

function flagValueHint(flag: FlagSpec): string {
  if (flag.kind === 'boolean') return ''
  if (flag.kind === 'number') return ' <n>'
  if (flag.kind === 'optional-string') return `[=<${flag.name}>]`
  return ` <${flag.name}>`
}

function formatFlagLine(flag: FlagSpec): string {
  const head = `  --${flag.name}${flagValueHint(flag)}`.padEnd(32)
  return `${head}${flag.description ?? ''}`
}

function printHelp(): void {
  process.stdout.write(
    [
      'aimux — terminal multiplexer and agent-friendly control plane.',
      '',
      'Usage:',
      '  aimux                                      Start the interactive TUI',
      '  aimux <group> <verb> [flags] [args]',
      '  aimux <group> --help                        List verbs in a group',
      '  aimux <group> <verb> --help                 Show flags/args for a verb',
      '',
      'Groups:',
      '',
    ].join('\n')
  )

  const byGroup = groupByCommand(COMMANDS)
  for (const [group, commands] of byGroup) {
    process.stdout.write(`  ${group}\n`)
    for (const command of commands) {
      const args = formatArgs(command.args)
      const signature = `aimux ${group} ${command.verb}${args === '' ? '' : ` ${args}`}`
      process.stdout.write(`    ${signature.padEnd(46)} ${command.summary}\n`)
    }
    process.stdout.write('\n')
  }

  process.stdout.write(
    [
      'Shared flags (accepted by every command):',
      ...SHARED_FLAGS.map(formatFlagLine),
      '',
      OUTPUT_CONTRACT_BLOCK,
      '',
      EXIT_CODES_BLOCK,
      '',
      'Env:',
      '  AIMUX_PROFILE                  Runtime profile (state dir, socket paths); --profile overrides.',
      '  AIMUX_PROJECT                Pin the target project (id or name); --project overrides.',
      '',
      'Agent recipe:',
      '  # create an isolated named worker, dispatch, and await one structured outcome',
      '  # --project pins the target repo so a UI project switch cannot redirect it',
      '  aimux worker run --project myrepo --name fixup --assistant claude "explain this repo"',
      '',
      'Maintenance:',
      '  aimux doctor | update | restart-daemon | restart-terminal-manager | version',
      '',
      'Shell completion:',
      '  Installed automatically on first launch (AIMUX_NO_COMPLETION_INSTALL=1 opts out).',
      '  aimux completion install | aimux completion <bash|zsh|fish>',
      '',
    ].join('\n')
  )
}

function printGroupHelp(group: string): void {
  const commands = COMMANDS.filter((c) => c.group === group)
  if (commands.length === 0) {
    printHelp()
    return
  }
  process.stdout.write(
    [
      `aimux ${group} — ${commands.length} verb${commands.length === 1 ? '' : 's'}`,
      '',
      'Usage:',
      `  aimux ${group} <verb> [flags] [args]`,
      `  aimux ${group} <verb> --help    Show flags/args for a verb`,
      '',
      'Verbs:',
      '',
    ].join('\n')
  )
  for (const command of commands) {
    const args = formatArgs(command.args)
    const signature = `aimux ${group} ${command.verb}${args === '' ? '' : ` ${args}`}`
    process.stdout.write(`  ${signature.padEnd(46)} ${command.summary}\n`)
  }
  process.stdout.write('\n')
}

function printCommandHelp(command: CliCommand): void {
  const args = formatArgs(command.args)
  const signature = `aimux ${command.group} ${command.verb}${args === '' ? '' : ` ${args}`}`
  process.stdout.write([signature, '', `  ${command.summary}`, '', 'Flags:', ''].join('\n'))
  const own = command.flags.filter((f) => !isSharedFlag(f.name))
  if (own.length === 0) {
    process.stdout.write('  (this command takes only the shared flags)\n')
  } else {
    for (const flag of own) process.stdout.write(`${formatFlagLine(flag)}\n`)
  }
  process.stdout.write('\nShared flags:\n')
  for (const flag of SHARED_FLAGS) process.stdout.write(`${formatFlagLine(flag)}\n`)
  process.stdout.write(`\n${OUTPUT_CONTRACT_BLOCK}\n\n${EXIT_CODES_BLOCK}\n`)
}

function argvRequestsHelp(argv: readonly string[]): boolean {
  return argv.includes('--help') || argv.includes('-h')
}

export async function runCli(argv: readonly string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printHelp()
    return EXIT_OK
  }

  const group = argv[0] ?? ''
  const verb = argv[1] ?? ''

  // `aimux worktree` was renamed to `aimux workspace`, and the old
  // `aimux workspace` became `aimux project`. Aliasing the groups would
  // silently change what `aimux workspace create` does, so refuse loudly for
  // a release instead.
  if (group === 'worktree') {
    writeError(
      '`aimux worktree` was renamed to `aimux workspace`, and the old `aimux workspace` is now `aimux project`. See docs/reference/cli.md'
    )
    return EXIT_USAGE
  }

  // `aimux <group> --help` (or bare `aimux <group>`) — group-scoped help. Print
  // the verb list without erroring on the missing verb, so agents can drill
  // down step by step.
  if (verb === '' || verb === '--help' || verb === '-h') {
    if (COMMANDS.some((c) => c.group === group)) {
      printGroupHelp(group)
      return EXIT_OK
    }
    writeError(`unknown group: ${group}`)
    printHelp()
    return EXIT_USAGE
  }

  const command = resolveCommand(group, verb)
  if (!command) {
    writeError(`unknown command: ${group} ${verb}`)
    printHelp()
    return EXIT_USAGE
  }

  // `aimux <group> <verb> --help` — verb-scoped help. Handle BEFORE parseArgs
  // so verbs that don't declare a `--help` flag don't reject it as unknown.
  if (argvRequestsHelp(argv.slice(2))) {
    printCommandHelp(command)
    return EXIT_OK
  }

  let parsed
  try {
    parsed = parseArgs(argv.slice(2), command.flags, command.args)
  } catch (error) {
    if (error instanceof CliUsageError) {
      writeError(error.message)
      writeError(`usage: aimux ${command.group} ${command.verb}`)
      writeJson({
        command: `${command.group} ${command.verb}`,
        error: error.message,
        kind: 'usage-error',
      })
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
    project: ReturnType<typeof resolveProjectWithOrigin> | null
  } = {
    daemon: null,
    project: null,
  }
  const resolveOnce = (): ReturnType<typeof resolveProjectWithOrigin> => {
    if (state.project) return state.project
    const projectFlag = typeof parsed.flags.project === 'string' ? parsed.flags.project : undefined
    state.project = resolveProjectWithOrigin(projectFlag)
    return state.project
  }
  const ctx: CliContext = {
    args: parsed,
    getDaemon: async () => {
      if (state.daemon) return state.daemon
      state.daemon = await connectToDaemon()
      return state.daemon
    },
    getProject: () => resolveOnce().record,
    getProjectOrigin: () => resolveOnce().origin,
    getProjects: () => listProjects(),
  }

  try {
    const code = await command.run(ctx)
    return code
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof CliUsageError) {
      writeError(message)
      writeJson({
        command: `${command.group} ${command.verb}`,
        error: message,
        kind: 'usage-error',
      })
      return EXIT_USAGE
    }
    // Classify by error type, not by string-sniffing the message: a runtime
    // error whose message happens to include "socket" (e.g. daemon reply
    // "socket write failed for tab X") must not masquerade as
    // daemon-unreachable, or CI that treats exit 4 as a "restart the daemon"
    // signal will retry spuriously.
    if (error instanceof DaemonUnreachableError) {
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

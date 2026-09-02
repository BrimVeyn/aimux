import type { PluginRecord } from './types'

import { getIpcDaemonSocketPath } from '../daemon/runtime-paths'
import { logDebug } from '../debug/input-log'

/**
 * The "a plugin can be written in any language" half, after herdr.
 *
 * A manifest's `commands[]` need no TypeScript and no `entries` at all: each is
 * an argv the daemon spawns with `AIMUX_*` in the environment, and the plugin
 * talks back through the `aimux` CLI it already has. That is the whole
 * contract — no SDK, no bindings, nothing to keep in sync per language.
 *
 * It lives in the daemon rather than in the CLI because a command should be
 * reachable from an event or a keybinding, not only from a shell. The CLI's
 * `aimux plugin exec` routes here through the control channel, so there is one
 * implementation rather than two.
 */

/** Long enough for a real task, short enough that a hung command is noticed. */
const COMMAND_TIMEOUT_MS = 600_000

/** Output kept per stream. A command that prints a megabyte is misusing this. */
const MAX_OUTPUT_BYTES = 256 * 1024

export interface ExecCommandView {
  pluginId: string
  id: string
  title: string
  command: string[]
  contexts?: string[]
}

export interface ExecResult {
  pluginId: string
  commandId: string
  exitCode: number
  stdout: string
  stderr: string
  /** True when the command was killed for exceeding the timeout. */
  timedOut: boolean
}

/** Every command declared across the given plugins, in discovery order. */
export function listExecCommands(records: readonly PluginRecord[]): ExecCommandView[] {
  const views: ExecCommandView[] = []
  for (const record of records) {
    if (!record.enabled) continue
    for (const command of record.manifest.commands ?? []) {
      views.push({
        command: command.command,
        contexts: command.contexts,
        id: command.id,
        pluginId: record.id,
        title: command.title ?? command.id,
      })
    }
  }
  return views
}

/**
 * What a spawned command is told about the world.
 *
 * `AIMUX_BIN_PATH` and `AIMUX_SOCKET_PATH` are the two that matter: with them a
 * command in any language can call back with `aimux tab send`, `aimux worker
 * run`, and the rest. Everything else is the plugin's own directories, so a
 * script does not have to re-derive the profile layout.
 */
export function buildExecEnv(
  record: PluginRecord,
  context: Record<string, unknown> = {}
): Record<string, string> {
  return {
    AIMUX_BIN_PATH: process.execPath,
    AIMUX_CONTEXT_JSON: JSON.stringify(context),
    // A marker a script can test for without parsing anything, the way
    // `CI=1` is tested for.
    AIMUX_ENV: '1',
    AIMUX_PLUGIN_CONFIG_DIR: record.paths.config,
    AIMUX_PLUGIN_ID: record.id,
    AIMUX_PLUGIN_ROOT: record.root,
    AIMUX_PLUGIN_STATE_DIR: record.paths.state,
    AIMUX_SOCKET_PATH: getIpcDaemonSocketPath(),
  }
}

function truncate(value: string): string {
  return value.length > MAX_OUTPUT_BYTES
    ? `${value.slice(0, MAX_OUTPUT_BYTES)}\n… output truncated`
    : value
}

/**
 * Runs one declared command. Resolves with the outcome rather than throwing on
 * a non-zero exit: an exit code is the command's answer, and the caller — a CLI
 * invocation, an event handler — decides what it means.
 *
 * Spawned with argv, never through a shell, so there is no quoting to get wrong
 * and nothing to inject into. `cwd` is the plugin's own directory, which is
 * what a relative `./script.sh` in a manifest means.
 */
export async function runExecCommand(
  record: PluginRecord,
  commandId: string,
  args: readonly string[] = [],
  context: Record<string, unknown> = {}
): Promise<ExecResult> {
  const declared = (record.manifest.commands ?? []).find((entry) => entry.id === commandId)
  if (!declared) {
    throw new Error(`plugin ${record.id} declares no command "${commandId}"`)
  }

  const argv = [...declared.command, ...args]
  logDebug('plugin.exec.start', { argv, commandId, pluginId: record.id })

  const proc = Bun.spawn(argv, {
    cwd: record.root,
    env: { ...process.env, ...buildExecEnv(record, context) },
    stderr: 'pipe',
    stdout: 'pipe',
  })

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    proc.kill()
  }, COMMAND_TIMEOUT_MS)

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  clearTimeout(timer)

  logDebug('plugin.exec.done', { commandId, exitCode, pluginId: record.id, timedOut })

  return {
    commandId,
    exitCode,
    pluginId: record.id,
    stderr: truncate(stderr),
    stdout: truncate(stdout),
    timedOut,
  }
}

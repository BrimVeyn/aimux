import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { ArgSpec, FlagSpec, ParsedArgs } from '../cli/flags'

import { ensureRuntimeDir } from '../daemon/runtime-paths'
import { logDebug } from '../debug/input-log'

/**
 * CLI commands contributed by plugins.
 *
 * A plugin's command runs in the *daemon*, not in the CLI process. The CLI is
 * one-shot and loads no plugin code by design: importing every plugin to
 * discover a verb would pay their startup cost on every `aimux tab list`, and
 * a broken plugin would break commands that have nothing to do with it.
 *
 * So the CLI learns the *shape* of a plugin command from a sidecar file the
 * daemon writes, and asks the daemon to *run* it. The split matters for
 * completion too: `aimux __complete` runs on every TAB press and must not open
 * a socket, but reading one small JSON file is fine.
 */

/** The declaration half — what the CLI needs to parse and complete a call. */
export interface PluginCliCommandSpec {
  pluginId: string
  group: string
  verb: string
  summary: string
  flags?: readonly FlagSpec[]
  args?: readonly ArgSpec[]
}

/** What the daemon needs on top: the thing that actually runs. */
export interface PluginCliCommand extends PluginCliCommandSpec {
  /** Whatever it returns is the command's JSON body on stdout. */
  run: (args: ParsedArgs) => Promise<unknown>
}

const commands = new Map<string, PluginCliCommand>()

function key(group: string, verb: string): string {
  return `${group} ${verb}`
}

export function pluginCliSidecarPath(): string {
  return join(ensureRuntimeDir(), 'plugin-cli.json')
}

/**
 * Writes the sidecar the CLI reads. Best-effort: a failure costs completion
 * and the "unknown command" message's accuracy, never the ability to run the
 * command — the daemon is asked by name either way.
 */
function writeSidecar(): void {
  const path = pluginCliSidecarPath()
  const specs: PluginCliCommandSpec[] = [...commands.values()].map((command) => ({
    args: command.args,
    flags: command.flags,
    group: command.group,
    pluginId: command.pluginId,
    summary: command.summary,
    verb: command.verb,
  }))
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify({ commands: specs, version: 1 }, null, 2)}\n`, 'utf8')
  } catch (error) {
    logDebug('plugin.cli.sidecarWriteFailed', {
      error: error instanceof Error ? error.message : String(error),
      path,
    })
  }
}

/**
 * Registers a command. Returns the disposer the plugin's fiber holds; the
 * sidecar is rewritten on both, so an unloaded plugin's verb stops being
 * offered by completion.
 */
export function registerPluginCliCommand(command: PluginCliCommand): () => void {
  const id = key(command.group, command.verb)
  commands.set(id, command)
  writeSidecar()
  return () => {
    if (commands.get(id) === command) commands.delete(id)
    writeSidecar()
  }
}

/** Test seam. Never called by the app. */
export function clearPluginCliCommands(): void {
  commands.clear()
}

export function getPluginCliCommand(group: string, verb: string): PluginCliCommand | undefined {
  return commands.get(key(group, verb))
}

export function listPluginCliCommands(): PluginCliCommand[] {
  return [...commands.values()]
}

/**
 * Reads the sidecar. Returns an empty list on anything unexpected — a missing
 * daemon, a partial write, a file from a future version. Completion offering
 * nothing is a non-event; completion throwing prints an error into the user's
 * prompt.
 */
export function readPluginCliSidecar(): PluginCliCommandSpec[] {
  const path = pluginCliSidecarPath()
  if (!existsSync(path)) return []
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return []
    const list = (parsed as { commands?: unknown }).commands
    if (!Array.isArray(list)) return []
    return list.filter(
      (entry): entry is PluginCliCommandSpec =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as PluginCliCommandSpec).group === 'string' &&
        typeof (entry as PluginCliCommandSpec).verb === 'string'
    )
  } catch {
    return []
  }
}

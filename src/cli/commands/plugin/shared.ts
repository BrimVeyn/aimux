import type { PluginConfigEntry } from '@brimveyn/aimux-config'
import type { PluginManifest } from '@brimveyn/aimux-plugin'

import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

import type { PluginRecord } from '../../../plugins/types'
import type { DaemonClient } from '../../client/daemon-client'

import { builtinPlugins } from '../../../builtin-plugins'
import { loadUserConfig } from '../../../config/loader'
import { IPC_CAPABILITY_PLUGIN_RPC } from '../../../ipc/protocol'
import { discoverPlugins, type PluginDiscoveryIssue } from '../../../plugins/discovery'
import { formatManifestIssues, readManifest } from '../../../plugins/manifest'
import { loadPluginRegistryResult, type PluginRegistryEntry } from '../../../plugins/registry-file'
import { PLUGIN_CONTROL_CLI_RUN, PLUGIN_CONTROL_ID } from '../../../plugins/rpc-envelope'
import { CliUsageError, type ParsedArgs } from '../../flags'

/**
 * Helpers shared by the `aimux plugin` verbs.
 *
 * One rule runs through all of them: **the CLI process never loads plugin
 * code.** It reads manifests and the registry, and it asks the daemon to do
 * anything that needs a running kernel. A one-shot CLI importing plugins would
 * pay their startup cost on every invocation and could be broken by a plugin
 * it has no reason to touch.
 */

export function resolvePluginRoot(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path)
}

/** Reads a manifest for a CLI verb, turning a bad one into a usage error. */
export async function readManifestOrThrow(root: string): Promise<PluginManifest> {
  if (!existsSync(root)) {
    throw new CliUsageError(`no such directory: ${root}`)
  }
  const result = await readManifest(root)
  if (!result.ok) {
    throw new CliUsageError(`${root}: ${formatManifestIssues(result.issues)}`)
  }
  return result.manifest
}

export function findRegistryEntry(id: string): PluginRegistryEntry | undefined {
  return loadPluginRegistryResult().registry.plugins.find((entry) => entry.id === id)
}

export function requireRegistryEntry(id: string): PluginRegistryEntry {
  const entry = findRegistryEntry(id)
  if (!entry) {
    throw new CliUsageError(`plugin "${id}" is not linked or installed — see \`aimux plugin list\``)
  }
  return entry
}

/**
 * Every plugin aimux knows about, resolved the way the hosts resolve them:
 * `aimux.config.ts`, the registry, and the shipped built-ins.
 *
 * The verbs that act on *any* plugin — enable, disable, set, unset, show —
 * take this rather than a registry row, because a row is only how a linked or
 * installed plugin is known. A built-in has none, which used to make it
 * untouchable from the CLI.
 */
export async function discoverAllPlugins(): Promise<{
  records: PluginRecord[]
  issues: PluginDiscoveryIssue[]
  userPlugins: readonly PluginConfigEntry[]
}> {
  const { resolved } = await loadUserConfig()
  const { issues, records } = await discoverPlugins(
    resolved.plugins,
    undefined,
    builtinPlugins(resolved)
  )
  return { issues, records, userPlugins: resolved.plugins }
}

/** The record for one id, or a usage error naming what to run instead. */
export async function requireKnownPlugin(id: string): Promise<{
  record: PluginRecord
  issues: PluginDiscoveryIssue[]
  userEntry: PluginConfigEntry | undefined
}> {
  const { issues, records, userPlugins } = await discoverAllPlugins()
  const record = records.find((entry) => entry.id === id)
  if (!record) {
    throw new CliUsageError(`unknown plugin "${id}" — see \`aimux plugin list\``)
  }
  return {
    issues,
    record,
    userEntry: userPlugins.find((entry) => entry.id === id),
  }
}

/**
 * Asks the daemon to act on its plugin kernel. The daemon reloads its own
 * halves and forwards the same instruction to every attached UI, so one
 * command reaches both processes.
 *
 * Optional by design: a linked plugin can be registered with no daemon
 * running, and the next launch picks it up. The caller decides whether that is
 * worth reporting.
 */
export async function notifyDaemon(
  getDaemon: () => Promise<DaemonClient>,
  verb: string,
  payload: unknown = {}
): Promise<{ ok: boolean; detail?: string; result?: unknown }> {
  try {
    const daemon = await getDaemon()
    if (!daemon.hasCapability(IPC_CAPABILITY_PLUGIN_RPC)) {
      return { detail: 'the running daemon predates plugin support (pre-v19)', ok: false }
    }
    const response = await daemon.request('pluginRequest', {
      payload,
      pluginId: PLUGIN_CONTROL_ID,
      verb,
    })
    if (response.type === 'error') {
      return { detail: response.payload.message, ok: false }
    }
    if (response.type !== 'pluginResult') {
      return { detail: `unexpected daemon response: ${response.type}`, ok: false }
    }
    return { ok: true, result: response.payload.result }
  } catch (error) {
    return { detail: error instanceof Error ? error.message : String(error), ok: false }
  }
}

/**
 * Asks the daemon to run a plugin's CLI command. Separate from `notifyDaemon`
 * because this one is the point of the invocation rather than a courtesy: an
 * unreachable daemon here is a failed command, not a deferred refresh.
 */
export async function runPluginCliCommand(
  getDaemon: () => Promise<DaemonClient>,
  group: string,
  verb: string,
  args: ParsedArgs
): Promise<{ ok: boolean; detail?: string; result?: unknown }> {
  const outcome = await notifyDaemon(getDaemon, PLUGIN_CONTROL_CLI_RUN, { args, group, verb })
  if (!outcome.ok) return outcome
  const payload = outcome.result as { result?: unknown } | undefined
  return { ok: true, result: payload?.result }
}

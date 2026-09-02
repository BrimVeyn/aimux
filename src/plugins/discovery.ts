import type { PluginConfigEntry } from '@brimveyn/aimux-config'

import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

import type { PluginRecord, PluginSource } from './types'

import { version as APP_VERSION } from '../../package.json'
import { logDebug } from '../debug/input-log'
import { getProfileConfigDir } from '../profile-paths'
import { buildBuiltinRecords, type BuiltinPlugin } from './builtin'
import {
  checkHostCompatibility,
  formatManifestIssues,
  type ManifestIssue,
  readManifest,
  resolvePluginConfig,
} from './manifest'
import { getPluginPaths } from './paths'
import { loadPluginRegistryResult } from './registry-file'

/**
 * Discovery answers one question: which plugins exist, where, and with what
 * configuration — all without executing a line of plugin code. Both host
 * processes run it independently and must agree, so it depends only on files:
 * `aimux-plugins.json`, `aimux.config.ts`, and each `aimux-plugin.json`.
 *
 * Precedence: manifest defaults ← registry ← `aimux.config.ts`. The
 * hand-written file wins over the machine-written one, always.
 */

export interface PluginDiscoveryIssue {
  id?: string
  path?: string
  message: string
}

export interface PluginDiscoveryResult {
  records: PluginRecord[]
  issues: PluginDiscoveryIssue[]
}

interface Candidate {
  root: string
  source: PluginSource
  enabled: boolean
  /** Registry-provided config; the user-config layer is applied on top. */
  registryConfig?: Record<string, unknown>
  userConfig?: Record<string, unknown>
  /** Id as declared, when the caller claimed one. Checked against the manifest. */
  declaredId?: string
}

/** Relative plugin paths resolve against the directory holding `aimux.config.ts`. */
function resolvePluginPath(path: string): string {
  return isAbsolute(path) ? path : resolve(getProfileConfigDir(), path)
}

function prefixIssues(id: string, issues: readonly ManifestIssue[]): string {
  return `${id}: ${formatManifestIssues(issues)}`
}

/**
 * Collects candidates from both sources. Registry rows come first so a user
 * config entry naming only an `id` can attach to one; an entry with a `path`
 * that duplicates a registry row replaces it, since the user wrote it last.
 */
function collectCandidates(
  userPlugins: readonly PluginConfigEntry[],
  issues: PluginDiscoveryIssue[]
): { byPath: Map<string, Candidate>; configOnly: PluginConfigEntry[] } {
  const byPath = new Map<string, Candidate>()

  const registry = loadPluginRegistryResult()
  for (const issue of registry.issues) issues.push({ message: issue })
  for (const entry of registry.registry.plugins) {
    const root = resolvePluginPath(entry.path)
    if (!existsSync(root)) {
      issues.push({
        id: entry.id,
        message: `registered directory is gone: ${root} (run \`aimux plugin unlink ${entry.id}\`)`,
        path: root,
      })
      continue
    }
    byPath.set(root, {
      declaredId: entry.id,
      enabled: entry.enabled,
      ...(entry.config === undefined ? {} : { registryConfig: entry.config }),
      root,
      source: entry.source,
    })
  }

  const configOnly: PluginConfigEntry[] = []
  for (const entry of userPlugins) {
    if (entry.path === undefined) {
      configOnly.push(entry)
      continue
    }
    const root = resolvePluginPath(entry.path)
    if (!existsSync(root)) {
      issues.push({
        message: `aimux.config.ts declares a plugin at ${root}, which does not exist`,
        path: root,
        ...(entry.id === undefined ? {} : { id: entry.id }),
      })
      continue
    }
    const existing = byPath.get(root)
    byPath.set(root, {
      declaredId: entry.id ?? existing?.declaredId,
      enabled: entry.enabled ?? existing?.enabled ?? true,
      root,
      source: existing?.source ?? 'config',
      ...(existing?.registryConfig === undefined
        ? {}
        : { registryConfig: existing.registryConfig }),
      ...(entry.config === undefined ? {} : { userConfig: entry.config }),
    })
  }

  return { byPath, configOnly }
}

/**
 * Reads every candidate's manifest and turns the valid ones into records.
 * An invalid manifest yields an issue, never a throw: one broken plugin must
 * not stop the others from loading.
 */
export async function discoverPlugins(
  userPlugins: readonly PluginConfigEntry[] = [],
  appVersion: string = APP_VERSION,
  builtins: readonly BuiltinPlugin[] = []
): Promise<PluginDiscoveryResult> {
  const issues: PluginDiscoveryIssue[] = []
  const { byPath, configOnly } = collectCandidates(userPlugins, issues)

  // `{ id, config }` entries with no path configure a candidate found above.
  const overridesById = new Map<string, PluginConfigEntry>()
  for (const entry of configOnly) {
    if (entry.id === undefined) continue
    overridesById.set(entry.id, entry)
  }

  // Built-ins come first: they exist before anything is linked, and putting
  // them through the same record list is what makes `plugin list`, `plugin
  // doctor`, config precedence and the kernel treat them as ordinary plugins.
  const builtin = buildBuiltinRecords(builtins, overridesById)
  const records: PluginRecord[] = [...builtin.records]
  const seenIds = new Set<string>(builtin.records.map((record) => record.id))
  for (const issue of builtin.issues) issues.push(issue)

  for (const candidate of byPath.values()) {
    const result = await readManifest(candidate.root)
    if (!result.ok) {
      issues.push({
        message: `${candidate.root}: ${formatManifestIssues(result.issues)}`,
        path: candidate.root,
        ...(candidate.declaredId === undefined ? {} : { id: candidate.declaredId }),
      })
      continue
    }
    const { manifest } = result

    if (candidate.declaredId !== undefined && candidate.declaredId !== manifest.id) {
      issues.push({
        id: candidate.declaredId,
        message: `directory ${candidate.root} now holds "${manifest.id}", not "${candidate.declaredId}"`,
        path: candidate.root,
      })
      continue
    }

    if (seenIds.has(manifest.id)) {
      issues.push({
        id: manifest.id,
        // A directory claiming a built-in's id lands here too, and "keeping
        // the first" is the right answer: the shipped one wins, and the user
        // is told which plugin was ignored.
        message: `declared twice; keeping the first`,
        path: candidate.root,
      })
      continue
    }

    const compatibility = checkHostCompatibility(manifest, appVersion)
    if (compatibility.length > 0) {
      issues.push({
        id: manifest.id,
        message: prefixIssues(manifest.id, compatibility),
        path: candidate.root,
      })
      continue
    }

    const override = overridesById.get(manifest.id)
    const resolved = resolvePluginConfig(
      manifest,
      candidate.registryConfig,
      candidate.userConfig,
      override?.config
    )
    for (const issue of resolved.issues) {
      issues.push({
        id: manifest.id,
        message: prefixIssues(manifest.id, [issue]),
        path: candidate.root,
      })
    }

    seenIds.add(manifest.id)
    records.push({
      config: resolved.config,
      enabled: override?.enabled ?? candidate.enabled,
      id: manifest.id,
      manifest,
      paths: getPluginPaths(manifest.id, candidate.root),
      root: candidate.root,
      source: candidate.source,
    })
  }

  for (const [id, entry] of overridesById) {
    if (seenIds.has(id)) continue
    issues.push({
      id,
      message: `aimux.config.ts configures "${id}", which is not linked or installed`,
      ...(entry.path === undefined ? {} : { path: entry.path }),
    })
  }

  logDebug('plugin.discovery', {
    issues: issues.length,
    records: records.map((record) => `${record.id}@${record.manifest.version}`),
  })

  return { issues, records }
}

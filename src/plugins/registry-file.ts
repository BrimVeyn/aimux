import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

import type { PluginSource } from './types'

import { logDebug } from '../debug/input-log'
import { getProfileConfigDir } from '../profile-paths'
import { getPluginRegistryFilePath } from './paths'

/**
 * `<profile>/aimux-plugins.json` — the machine-written half of plugin
 * configuration. `aimux plugin link/install`, `plugin enable/disable`,
 * `plugin set` and the settings screen all write it.
 *
 * Two blocks, answering two different questions. `plugins[]` says *where the
 * code is*, and only a linked or installed plugin has a row there. `overrides`
 * says *how the user has set it*, keyed by id — so a built-in, a link, an
 * install and a plugin declared inline in `aimux.config.ts` are all toggled
 * and configured the same way. Before that split, a built-in had no row to
 * toggle and `plugin disable` had to apologise and point at the config file.
 *
 * `aimux.config.ts` is the hand-written half and outranks both, so a user who
 * declares a plugin in their config file never has to reconcile the two.
 *
 * Validation is per entry, like `loadConfigResult`: one malformed row is
 * dropped with an issue, and the rest of the file still loads. A registry
 * that refuses to parse would take every plugin down with it.
 */

export const PLUGIN_REGISTRY_VERSION = 1

export interface PluginRegistryEntry {
  id: string
  source: Extract<PluginSource, 'link' | 'install'>
  /** Absolute path to the plugin directory. */
  path: string
  enabled: boolean
  config?: Record<string, unknown>
  /** Manifest version at link/install time; diagnostic only. */
  version?: string
  /** For `install`: where it came from, so `plugin update` knows. */
  origin?: string
}

/**
 * What the user has set for one plugin, whatever kind it is. Both fields are
 * optional: an override exists to say one thing, not to restate the defaults.
 */
export interface PluginOverride {
  enabled?: boolean
  config?: Record<string, unknown>
}

export interface PluginRegistry {
  version: number
  plugins: PluginRegistryEntry[]
  overrides: Record<string, PluginOverride>
}

export interface PluginRegistryLoadResult {
  registry: PluginRegistry
  issues: string[]
}

function emptyRegistry(): PluginRegistry {
  return { overrides: {}, plugins: [], version: PLUGIN_REGISTRY_VERSION }
}

/**
 * One override. A malformed one is dropped with an issue rather than taken
 * partially: half an override is a plugin configured in a way nobody wrote.
 */
function parseOverride(id: string, value: unknown, issues: string[]): PluginOverride | null {
  if (!isRecord(value)) {
    issues.push(`overrides.${id}: not an object`)
    return null
  }
  const override: PluginOverride = {}
  if (typeof value.enabled === 'boolean') override.enabled = value.enabled
  else if (value.enabled !== undefined) issues.push(`overrides.${id}.enabled: not a boolean`)
  if (isRecord(value.config)) override.config = value.config
  else if (value.config !== undefined) issues.push(`overrides.${id}.config: not an object`)
  return override
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseEntry(value: unknown, index: number, issues: string[]): PluginRegistryEntry | null {
  if (!isRecord(value)) {
    issues.push(`plugins[${index}]: not an object`)
    return null
  }
  const { id, path } = value
  if (typeof id !== 'string' || id === '') {
    issues.push(`plugins[${index}].id: missing or not a string`)
    return null
  }
  if (typeof path !== 'string' || path === '') {
    issues.push(`plugins[${index}].path: missing or not a string (${id})`)
    return null
  }
  const source = value.source === 'install' ? 'install' : 'link'
  const entry: PluginRegistryEntry = {
    enabled: value.enabled !== false,
    id,
    path,
    source,
  }
  if (isRecord(value.config)) entry.config = value.config
  else if (value.config !== undefined)
    issues.push(`plugins[${index}].config: not an object (${id})`)
  if (typeof value.version === 'string') entry.version = value.version
  if (typeof value.origin === 'string') entry.origin = value.origin
  return entry
}

export function loadPluginRegistryResult(): PluginRegistryLoadResult {
  const path = getPluginRegistryFilePath()
  if (!existsSync(path)) return { issues: [], registry: emptyRegistry() }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logDebug('plugin.registry.parseFailed', { error: message, path })
    return { issues: [`${path} is not valid JSON: ${message}`], registry: emptyRegistry() }
  }

  const issues: string[] = []
  if (!isRecord(parsed)) {
    return { issues: [`${path}: expected a JSON object`], registry: emptyRegistry() }
  }
  if (parsed.version !== undefined && parsed.version !== PLUGIN_REGISTRY_VERSION) {
    issues.push(`unsupported plugin registry version ${JSON.stringify(parsed.version)}`)
  }

  const rows = Array.isArray(parsed.plugins) ? parsed.plugins : []
  if (!Array.isArray(parsed.plugins) && parsed.plugins !== undefined) {
    issues.push('plugins: expected an array')
  }

  const plugins: PluginRegistryEntry[] = []
  const seen = new Set<string>()
  for (const [index, row] of rows.entries()) {
    const entry = parseEntry(row, index, issues)
    if (!entry) continue
    if (seen.has(entry.id)) {
      issues.push(`plugins[${index}]: duplicate id ${entry.id}, keeping the first`)
      continue
    }
    seen.add(entry.id)
    plugins.push(entry)
  }

  const overrides: Record<string, PluginOverride> = {}
  if (isRecord(parsed.overrides)) {
    for (const [id, raw] of Object.entries(parsed.overrides)) {
      const override = parseOverride(id, raw, issues)
      if (override) overrides[id] = override
    }
  } else if (parsed.overrides !== undefined) {
    issues.push('overrides: expected an object')
  }

  return { issues, registry: { overrides, plugins, version: PLUGIN_REGISTRY_VERSION } }
}

export function savePluginRegistry(registry: PluginRegistry): boolean {
  const path = getPluginRegistryFilePath()
  try {
    mkdirSync(getProfileConfigDir(), { recursive: true })
    const ordered: PluginRegistry = {
      // Sorted so a hand-edit or a diff of this file reads the same way twice.
      overrides: Object.fromEntries(
        Object.entries(registry.overrides).sort(([a], [b]) => a.localeCompare(b))
      ),
      plugins: [...registry.plugins].sort((a, b) => a.id.localeCompare(b.id)),
      version: PLUGIN_REGISTRY_VERSION,
    }
    writeFileSync(path, `${JSON.stringify(ordered, null, 2)}\n`, 'utf8')
    return true
  } catch (error) {
    logDebug('plugin.registry.saveFailed', {
      error: error instanceof Error ? error.message : String(error),
      path,
    })
    return false
  }
}

/** Insert or replace one entry, preserving config the caller did not set. */
export function upsertPluginRegistryEntry(entry: PluginRegistryEntry): boolean {
  const { registry } = loadPluginRegistryResult()
  const index = registry.plugins.findIndex((row) => row.id === entry.id)
  if (index === -1) registry.plugins.push(entry)
  else registry.plugins[index] = { ...registry.plugins[index], ...entry }
  return savePluginRegistry(registry)
}

export function removePluginRegistryEntry(id: string): boolean {
  const { registry } = loadPluginRegistryResult()
  const next = registry.plugins.filter((row) => row.id !== id)
  if (next.length === registry.plugins.length) return false
  return savePluginRegistry({ ...registry, plugins: next })
}

export function getPluginOverride(id: string): PluginOverride | undefined {
  return loadPluginRegistryResult().registry.overrides[id]
}

/**
 * Merges a patch into one plugin's override. `config` merges key by key so
 * setting one value does not drop the others; an explicit `undefined` for a
 * key removes it, which is what `plugin unset` needs.
 *
 * An override that ends up saying nothing is deleted rather than left as an
 * empty object: the file should record decisions, not the absence of them.
 */
export function setPluginOverride(id: string, patch: PluginOverride): boolean {
  const { registry } = loadPluginRegistryResult()
  const current = registry.overrides[id] ?? {}
  const next: PluginOverride = { ...current }

  if (patch.enabled !== undefined) next.enabled = patch.enabled
  if (patch.config !== undefined) {
    const config = { ...current.config }
    for (const [key, value] of Object.entries(patch.config)) {
      if (value === undefined) delete config[key]
      else config[key] = value
    }
    if (Object.keys(config).length === 0) delete next.config
    else next.config = config
  }

  if (next.enabled === undefined && next.config === undefined) delete registry.overrides[id]
  else registry.overrides[id] = next
  return savePluginRegistry(registry)
}

/**
 * Enable or disable any plugin — built-in, linked, installed, or declared in
 * `aimux.config.ts`. It writes an override rather than a registry row's
 * `enabled` field, which is what makes the four kinds behave alike; the row's
 * own `enabled` is still read as a layer beneath, so files written before this
 * keep working.
 */
export function setPluginEnabled(id: string, enabled: boolean): boolean {
  return setPluginOverride(id, { enabled })
}

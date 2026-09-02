import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

import type { PluginSource } from './types'

import { logDebug } from '../debug/input-log'
import { getProfileConfigDir } from '../profile-paths'
import { getPluginRegistryFilePath } from './paths'

/**
 * `<profile>/aimux-plugins.json` — the machine-written half of plugin
 * configuration. `aimux plugin link/install/enable/disable` write it; the
 * settings screen will write per-plugin config into it in a later phase.
 *
 * `aimux.config.ts` is the hand-written half and outranks it, so a user who
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

export interface PluginRegistry {
  version: number
  plugins: PluginRegistryEntry[]
}

export interface PluginRegistryLoadResult {
  registry: PluginRegistry
  issues: string[]
}

const EMPTY: PluginRegistry = { plugins: [], version: PLUGIN_REGISTRY_VERSION }

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
  if (!existsSync(path)) return { issues: [], registry: { ...EMPTY, plugins: [] } }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logDebug('plugin.registry.parseFailed', { error: message, path })
    return {
      issues: [`${path} is not valid JSON: ${message}`],
      registry: { ...EMPTY, plugins: [] },
    }
  }

  const issues: string[] = []
  if (!isRecord(parsed)) {
    return { issues: [`${path}: expected a JSON object`], registry: { ...EMPTY, plugins: [] } }
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

  return { issues, registry: { plugins, version: PLUGIN_REGISTRY_VERSION } }
}

export function savePluginRegistry(registry: PluginRegistry): boolean {
  const path = getPluginRegistryFilePath()
  try {
    mkdirSync(getProfileConfigDir(), { recursive: true })
    const ordered: PluginRegistry = {
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

export function setPluginEnabled(id: string, enabled: boolean): boolean {
  const { registry } = loadPluginRegistryResult()
  const entry = registry.plugins.find((row) => row.id === id)
  if (!entry) return false
  entry.enabled = enabled
  return savePluginRegistry(registry)
}

import type { PluginConfigField, PluginManifest } from '@brimveyn/aimux-plugin'

import type { PluginOverride } from './registry-file'

/**
 * Which layer a plugin's configuration value came from, per key.
 *
 * One implementation, used by `aimux plugin config` and by the settings rows,
 * so the two can never disagree about which layer won. They would: the CLI
 * reads the registry and the screen reads a store built from the same records,
 * and a second copy of this ladder would drift the first time a layer moved.
 *
 * The ladder, lowest first:
 *
 *   manifest default  ←  built-in seed  ←  registry row  ←  registry override
 *                     ←  aimux.config.ts
 */

export type PluginConfigOrigin = 'unset' | 'manifest-default' | 'builtin' | 'registry' | 'config'

export interface PluginConfigFieldReport {
  key: string
  type: PluginConfigField['type']
  label: string
  description?: string
  required: boolean
  secret: boolean
  default?: string | number | boolean
  /** The effective value, or `<secret>` when the field is one. */
  value: unknown
  /** False when nothing above the manifest default has spoken. */
  isSet: boolean
  origin: PluginConfigOrigin
  /**
   * Set when a layer above the one that would normally be written keeps
   * winning — today only `aimux.config.ts`. A write still happens and is still
   * recorded; it is simply outranked, and saying so beats a value that
   * silently does nothing.
   */
  shadowedBy?: 'aimux.config.ts'
}

/** Never echoed: not in the CLI, not on the settings screen, not in a log. */
export const SECRET_PLACEHOLDER = '<secret>'

export interface ConfigLayers {
  /** `<profile>/aimux-plugins.json` → `overrides[id]`. */
  override?: PluginOverride
  /** The `aimux.config.ts` entry for this plugin, if it has one. */
  userConfig?: Record<string, unknown>
  /** A built-in's seeded values — `BuiltinPlugin.config`. */
  builtinConfig?: Record<string, unknown>
  /** A registry row's own `config`, written before overrides existed. */
  rowConfig?: Record<string, unknown>
}

export type PluginKeymapOrigin = 'default' | 'registry' | 'config'

export interface ResolvedPluginKeymap {
  id: string
  mode: string
  action: string
  description?: string
  key: string | null
  default: string
  origin: PluginKeymapOrigin
  shadowedBy?: 'aimux.config.ts'
}

export function describePluginKeymaps(
  manifest: PluginManifest,
  layers: { override?: PluginOverride; userConfig?: Record<string, string | null> }
): ResolvedPluginKeymap[] {
  return (manifest.contributes?.keymaps ?? []).map((binding) => {
    const id = binding.id ?? binding.action
    const fromConfig = layers.userConfig?.[id]
    const fromRegistry = layers.override?.keymaps?.[id]
    let key: string | null = binding.key
    let origin: PluginKeymapOrigin = 'default'
    if (fromRegistry !== undefined) {
      key = fromRegistry
      origin = 'registry'
    }
    if (fromConfig !== undefined) {
      key = fromConfig
      origin = 'config'
    }
    const report: ResolvedPluginKeymap = {
      action: binding.action,
      default: binding.key,
      id,
      key,
      mode: binding.mode,
      origin,
    }
    if (binding.description !== undefined) report.description = binding.description
    if (fromConfig !== undefined) report.shadowedBy = 'aimux.config.ts'
    return report
  })
}

function originOf(key: string, layers: ConfigLayers, hasDefault: boolean): PluginConfigOrigin {
  if (layers.userConfig?.[key] !== undefined) return 'config'
  if (layers.override?.config?.[key] !== undefined) return 'registry'
  if (layers.rowConfig?.[key] !== undefined) return 'registry'
  if (layers.builtinConfig?.[key] !== undefined) return 'builtin'
  return hasDefault ? 'manifest-default' : 'unset'
}

/**
 * Every field the manifest declares, with where its value came from. Keys the
 * resolved config carries but the schema does not declare are reported
 * separately by `undeclaredKeys` — `resolvePluginConfig` lets them through by
 * design, and hiding them would make this disagree with what the plugin gets.
 */
export function describePluginConfig(
  manifest: PluginManifest,
  resolved: Record<string, unknown>,
  layers: ConfigLayers
): PluginConfigFieldReport[] {
  const schema = manifest.config ?? {}
  return Object.entries(schema).map(([key, field]) => {
    const origin = originOf(key, layers, field.default !== undefined)
    const secret = field.secret === true
    const report: PluginConfigFieldReport = {
      isSet: origin !== 'unset' && origin !== 'manifest-default',
      key,
      label: field.label ?? key,
      origin,
      required: field.required === true,
      secret,
      type: field.type,
      value: secret && resolved[key] !== undefined ? SECRET_PLACEHOLDER : resolved[key],
    }
    if (field.description !== undefined) report.description = field.description
    if (field.default !== undefined) report.default = field.default
    if (layers.userConfig?.[key] !== undefined) report.shadowedBy = 'aimux.config.ts'
    return report
  })
}

/** Resolved keys the manifest does not declare. Passed through, so reported. */
export function undeclaredKeys(
  manifest: PluginManifest,
  resolved: Record<string, unknown>
): Record<string, unknown> {
  const schema = manifest.config ?? {}
  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(resolved)) {
    if (schema[key] === undefined) extra[key] = value
  }
  return extra
}

/**
 * Coerces a CLI-supplied string against the declared type.
 *
 * Refuses rather than guesses: `resolvePluginConfig` drops a value of the
 * wrong type with an issue, so a `plugin set` that coerced loosely would write
 * something the plugin then never receives — the worst outcome available,
 * because nothing fails.
 */
export function coerceConfigValue(
  field: PluginConfigField,
  raw: string
): { ok: true; value: string | number | boolean } | { ok: false; message: string } {
  if (field.type === 'string') return { ok: true, value: raw }
  if (field.type === 'boolean') {
    if (raw === 'true') return { ok: true, value: true }
    if (raw === 'false') return { ok: true, value: false }
    return { message: `expected true or false, got ${JSON.stringify(raw)}`, ok: false }
  }
  const value = Number(raw)
  if (raw.trim() === '' || Number.isNaN(value)) {
    return { message: `expected a number, got ${JSON.stringify(raw)}`, ok: false }
  }
  return { ok: true, value }
}

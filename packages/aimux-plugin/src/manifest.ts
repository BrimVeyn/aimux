// The manifest — `aimux-plugin.json` — is everything the host must know
// *before* it runs a line of plugin code: which halves exist (so it knows
// which process to reload), which API version the code was written against,
// what configuration it takes (so the settings screen can be generated), and
// which subprocess commands it contributes.
//
// It is therefore parsed and validated on its own, never by importing the
// plugin. `validateManifest` in the host reports the offending field by name.

/** API generation the plugin was written against. Bumped only on a break. */
export const PLUGIN_API_VERSION = 1

/** Which host process a plugin half runs in. The terminal manager loads none. */
export type PluginHost = 'ui' | 'daemon'

export type PluginConfigFieldType = 'string' | 'number' | 'boolean'

export interface PluginConfigField {
  type: PluginConfigFieldType
  /** Shown as the settings-row label; defaults to the field key. */
  label?: string
  description?: string
  /** Applied when neither the registry nor `aimux.config.ts` provides a value. */
  default?: string | number | boolean
  /** Required fields make the plugin fail to load rather than misbehave. */
  required?: boolean
  /**
   * Secrets are never echoed: not in `aimux plugin list`, not in the settings
   * screen, not in the plugin log. Storage is still plaintext JSON — this is
   * shoulder-surfing hygiene, not encryption.
   */
  secret?: boolean
}

/**
 * A subprocess contribution, herdr-style. Interpreted by the built-in
 * `aimux.exec` plugin (phase 3); parsed and carried here from day one so a
 * manifest written against the documented schema does not have to change.
 */
export interface PluginCommandSpec {
  id: string
  title?: string
  /** argv, not a shell string — no quoting rules to get wrong. */
  command: string[]
  /** Where the command may be invoked from. */
  contexts?: string[]
}

export interface PluginManifest {
  /** Reverse-DNS-ish, `<vendor>.<name>`; the namespace for every registration. */
  id: string
  /** Human-facing name. Defaults to `id` when absent. */
  name?: string
  version: string
  description?: string
  /** Refuses to load on an older aimux. Semver, compared numerically. */
  minAimuxVersion?: string
  apiVersion: number
  /** Entry files per host, relative to the plugin root. Both are optional. */
  entries?: Partial<Record<PluginHost, string>>
  /** argv lists run once at install/link time (typically `bun install`). */
  build?: string[][]
  config?: Record<string, PluginConfigField>
  commands?: PluginCommandSpec[]
}

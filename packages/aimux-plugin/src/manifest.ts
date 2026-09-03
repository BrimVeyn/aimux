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

/**
 * Where a plugin's bar widget goes when nothing has placed it yet.
 *
 * A proposal, not a claim: the host places it once, marks the placement as the
 * plugin's, and never re-places it — so a user who moves it, hides it, or
 * throws it out has the last word, and an unload withdraws only what it put
 * there and the user left alone.
 */
export interface PluginBarContribution {
  /** Unqualified widget id — the same one `ctx.ui.widgets.register` takes. */
  widget: string
  /** Default `left`. */
  side?: 'left' | 'right'
  /** Default `end`. */
  position?: 'start' | 'end'
  /** Share of the bar, relative to its neighbours. Default 50. */
  grow?: number
}

/**
 * A keybinding a plugin asks for. Refused rather than applied when the key is
 * already bound in `aimux.config.ts`: the file the user writes by hand outranks
 * every plugin, here as everywhere else.
 */
export interface PluginKeymapContribution {
  /** Mode id, e.g. `navigation`, or the plugin's own pane mode. */
  mode: string
  /** Key notation, `<leader>` included. */
  key: string
  /** Unqualified action verb — the host prefixes it with the plugin id. */
  action: string
}

export interface PluginContributions {
  bars?: PluginBarContribution[]
  keymaps?: PluginKeymapContribution[]
}

/**
 * A pane that runs a program, declared rather than registered — the manifest
 * twin of `ctx.ui.panes.registerCommand`. `cwd` reads as it does there.
 */
export interface PluginCommandPaneSpec {
  id: string
  title?: string
  /** argv, not a shell string. */
  command: string[]
  cwd?: string
}

/**
 * A long-running process the daemon supervises: started when the plugin
 * loads, stopped when it unloads, restarted according to `restart`. A relay,
 * a watcher, a bridge — anything that is not a command that finishes.
 *
 * Runs with the same `AIMUX_*` environment as `commands[]`, so it can call
 * back through the CLI in any language.
 */
export interface PluginServiceSpec {
  id: string
  /** argv, not a shell string. */
  command: string[]
  /** Default `on-failure`: a clean exit stays down, a crash comes back. */
  restart?: 'never' | 'on-failure' | 'always'
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
  /** Panes that host a program. Applied when the UI half loads — or, with no UI entry, at once. */
  panes?: PluginCommandPaneSpec[]
  /** Processes the daemon keeps alive for the plugin. */
  services?: PluginServiceSpec[]
  /**
   * What the plugin asks the interface for: a place for its widget, a key for
   * its action. Applied by the host when the UI half loads, withdrawn when it
   * unloads, and outranked by anything the user has decided.
   */
  contributes?: PluginContributions
}

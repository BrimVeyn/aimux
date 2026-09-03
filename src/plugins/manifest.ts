import {
  PLUGIN_API_VERSION,
  type PluginBarContribution,
  type PluginCommandPaneSpec,
  type PluginCommandSpec,
  type PluginConfigField,
  type PluginContributions,
  type PluginHost,
  type PluginKeymapContribution,
  type PluginManifest,
  type PluginServiceSpec,
} from '@brimveyn/aimux-plugin'
import { join } from 'node:path'

export const PLUGIN_MANIFEST_FILENAME = 'aimux-plugin.json'

/**
 * `<vendor>.<name>`, lowercase. The dot is required: a plugin id is the
 * namespace for every registration it makes — widget ids, keymap modes, RPC
 * verbs — and an unqualified `notify` would collide the first time two people
 * had the same idea.
 */
const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/

const CONFIG_FIELD_TYPES = new Set(['string', 'number', 'boolean'])

/**
 * A validation failure names the offending field. That message is what a
 * plugin author — or the agent writing the plugin — reads in a loop from
 * `aimux plugin doctor`, so "entries.ui must be a relative path" beats
 * "invalid manifest" by the whole margin that matters.
 */
export interface ManifestIssue {
  field: string
  message: string
}

export type ManifestResult =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; issues: ManifestIssue[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Numeric semver comparison, prerelease suffix ignored. Enough for
 * `minAimuxVersion`, which only ever asks "is the host new enough".
 */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string): number[] =>
    value
      .trim()
      .replace(/^v/, '')
      .split('-')[0]
      ?.split('.')
      .map((part) => Number.parseInt(part, 10)) ?? []
  const left = parse(a)
  const right = parse(b)
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i++) {
    const l = left[i] ?? 0
    const r = right[i] ?? 0
    if (Number.isNaN(l) || Number.isNaN(r)) return 0
    if (l !== r) return l < r ? -1 : 1
  }
  return 0
}

function validateEntries(
  value: unknown,
  issues: ManifestIssue[]
): Partial<Record<PluginHost, string>> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) {
    issues.push({
      field: 'entries',
      message: 'must be an object mapping "ui" and/or "daemon" to a file path',
    })
    return undefined
  }
  const entries: Partial<Record<PluginHost, string>> = {}
  for (const host of ['ui', 'daemon'] as const) {
    const entry = value[host]
    if (entry === undefined) continue
    if (!isNonEmptyString(entry)) {
      issues.push({ field: `entries.${host}`, message: 'must be a non-empty file path' })
      continue
    }
    if (entry.startsWith('/') || entry.includes('..')) {
      issues.push({
        field: `entries.${host}`,
        message: 'must be a relative path inside the plugin directory (no "/" prefix, no "..")',
      })
      continue
    }
    entries[host] = entry
  }
  for (const key of Object.keys(value)) {
    if (key !== 'ui' && key !== 'daemon') {
      issues.push({
        field: `entries.${key}`,
        message: 'unknown host; only "ui" and "daemon" load plugins',
      })
    }
  }
  return entries
}

function validateConfigSchema(
  value: unknown,
  issues: ManifestIssue[]
): Record<string, PluginConfigField> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) {
    issues.push({
      field: 'config',
      message: 'must be an object mapping field names to field descriptors',
    })
    return undefined
  }
  const schema: Record<string, PluginConfigField> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (!isRecord(raw)) {
      issues.push({ field: `config.${key}`, message: 'must be an object with at least a "type"' })
      continue
    }
    if (typeof raw.type !== 'string' || !CONFIG_FIELD_TYPES.has(raw.type)) {
      issues.push({
        field: `config.${key}.type`,
        message: 'must be one of "string", "number", "boolean"',
      })
      continue
    }
    const field: PluginConfigField = { type: raw.type as PluginConfigField['type'] }
    if (isNonEmptyString(raw.label)) field.label = raw.label
    if (isNonEmptyString(raw.description)) field.description = raw.description
    if (raw.required !== undefined) field.required = raw.required === true
    if (raw.secret !== undefined) field.secret = raw.secret === true
    if (raw.default !== undefined) {
      if (typeof raw.default !== field.type) {
        issues.push({
          field: `config.${key}.default`,
          message: `must be a ${field.type} to match the declared type`,
        })
        continue
      }
      field.default = raw.default as PluginConfigField['default']
    }
    schema[key] = field
  }
  return schema
}

function validateBuild(value: unknown, issues: ManifestIssue[]): string[][] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    issues.push({
      field: 'build',
      message: 'must be an array of argv arrays, e.g. [["bun", "install"]]',
    })
    return undefined
  }
  const build: string[][] = []
  for (const [index, step] of value.entries()) {
    if (!Array.isArray(step) || step.length === 0 || !step.every(isNonEmptyString)) {
      issues.push({
        field: `build[${index}]`,
        message: 'must be a non-empty array of strings (argv, not a shell string)',
      })
      continue
    }
    build.push(step as string[])
  }
  return build
}

function validateCommands(
  value: unknown,
  issues: ManifestIssue[]
): PluginCommandSpec[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    issues.push({ field: 'commands', message: 'must be an array of command descriptors' })
    return undefined
  }
  const commands: PluginCommandSpec[] = []
  for (const [index, raw] of value.entries()) {
    if (!isRecord(raw)) {
      issues.push({ field: `commands[${index}]`, message: 'must be an object' })
      continue
    }
    if (!isNonEmptyString(raw.id)) {
      issues.push({ field: `commands[${index}].id`, message: 'must be a non-empty string' })
      continue
    }
    if (
      !Array.isArray(raw.command) ||
      raw.command.length === 0 ||
      !raw.command.every(isNonEmptyString)
    ) {
      issues.push({
        field: `commands[${index}].command`,
        message: 'must be a non-empty array of strings (argv, not a shell string)',
      })
      continue
    }
    const command: PluginCommandSpec = { command: raw.command as string[], id: raw.id }
    if (isNonEmptyString(raw.title)) command.title = raw.title
    if (Array.isArray(raw.contexts)) command.contexts = raw.contexts.filter(isNonEmptyString)
    commands.push(command)
  }
  return commands
}

const SERVICE_RESTART = new Set(['never', 'on-failure', 'always'])

/** Shared by `panes[]` and `services[]`: an id and an argv, or a named issue. */
function validateArgvEntries(
  field: string,
  value: unknown,
  issues: ManifestIssue[]
): { at: string; raw: Record<string, unknown>; command: string[] }[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    issues.push({ field, message: 'must be an array of descriptors' })
    return undefined
  }
  const entries: { at: string; raw: Record<string, unknown>; command: string[] }[] = []
  for (const [index, raw] of value.entries()) {
    const at = `${field}[${index}]`
    if (!isRecord(raw)) {
      issues.push({ field: at, message: 'must be an object' })
      continue
    }
    if (!isNonEmptyString(raw.id)) {
      issues.push({ field: `${at}.id`, message: 'must be a non-empty string' })
      continue
    }
    if (
      !Array.isArray(raw.command) ||
      raw.command.length === 0 ||
      !raw.command.every(isNonEmptyString)
    ) {
      issues.push({
        field: `${at}.command`,
        message: 'must be a non-empty array of strings (argv, not a shell string)',
      })
      continue
    }
    entries.push({ at, command: raw.command as string[], raw })
  }
  return entries
}

/** Panes that host a program — see `PluginCommandPaneSpec`. */
function validatePanes(
  value: unknown,
  issues: ManifestIssue[]
): PluginCommandPaneSpec[] | undefined {
  const entries = validateArgvEntries('panes', value, issues)
  if (entries === undefined) return undefined
  const panes: PluginCommandPaneSpec[] = []
  for (const { at, command, raw } of entries) {
    if (raw.cwd !== undefined && !isNonEmptyString(raw.cwd)) {
      issues.push({
        field: `${at}.cwd`,
        message: 'must be "workspace", "project", "plugin" or an absolute path',
      })
      continue
    }
    const pane: PluginCommandPaneSpec = { command, id: raw.id as string }
    if (isNonEmptyString(raw.title)) pane.title = raw.title
    if (isNonEmptyString(raw.cwd)) pane.cwd = raw.cwd
    panes.push(pane)
  }
  return panes
}

/** Supervised processes — see `PluginServiceSpec`. */
function validateServices(
  value: unknown,
  issues: ManifestIssue[]
): PluginServiceSpec[] | undefined {
  const entries = validateArgvEntries('services', value, issues)
  if (entries === undefined) return undefined
  const services: PluginServiceSpec[] = []
  for (const { at, command, raw } of entries) {
    if (
      raw.restart !== undefined &&
      (typeof raw.restart !== 'string' || !SERVICE_RESTART.has(raw.restart))
    ) {
      issues.push({ field: `${at}.restart`, message: 'must be "never", "on-failure" or "always"' })
      continue
    }
    const service: PluginServiceSpec = { command, id: raw.id as string }
    if (typeof raw.restart === 'string')
      service.restart = raw.restart as PluginServiceSpec['restart']
    services.push(service)
  }
  return services
}

/**
 * What the plugin asks the interface for. Every issue names the offending
 * entry — `contributes.bars[0].side` — because this block is written by hand
 * (often by an agent), and "invalid contributes" would send them reading the
 * source instead of the message.
 */
function validateContributes(
  value: unknown,
  issues: ManifestIssue[]
): PluginContributions | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) {
    issues.push({
      field: 'contributes',
      message: 'must be an object with "bars" and/or "keymaps"',
    })
    return undefined
  }

  const contributions: PluginContributions = {}

  if (value.bars !== undefined) {
    if (!Array.isArray(value.bars)) {
      issues.push({ field: 'contributes.bars', message: 'must be an array of placements' })
    } else {
      const bars: PluginBarContribution[] = []
      for (const [index, raw] of value.bars.entries()) {
        const at = `contributes.bars[${index}]`
        if (!isRecord(raw)) {
          issues.push({ field: at, message: 'must be an object' })
          continue
        }
        if (!isNonEmptyString(raw.widget)) {
          issues.push({
            field: `${at}.widget`,
            message: 'must be the unqualified widget id, as passed to ctx.ui.widgets.register',
          })
          continue
        }
        if (raw.side !== undefined && raw.side !== 'left' && raw.side !== 'right') {
          issues.push({ field: `${at}.side`, message: 'must be "left" or "right"' })
          continue
        }
        if (raw.position !== undefined && raw.position !== 'start' && raw.position !== 'end') {
          issues.push({ field: `${at}.position`, message: 'must be "start" or "end"' })
          continue
        }
        if (
          raw.grow !== undefined &&
          (typeof raw.grow !== 'number' || !Number.isFinite(raw.grow) || raw.grow <= 0)
        ) {
          issues.push({ field: `${at}.grow`, message: 'must be a number greater than 0' })
          continue
        }
        const entry: PluginBarContribution = { widget: raw.widget }
        if (raw.side !== undefined) entry.side = raw.side
        if (raw.position !== undefined) entry.position = raw.position
        if (typeof raw.grow === 'number') entry.grow = raw.grow
        bars.push(entry)
      }
      contributions.bars = bars
    }
  }

  if (value.keymaps !== undefined) {
    if (!Array.isArray(value.keymaps)) {
      issues.push({ field: 'contributes.keymaps', message: 'must be an array of bindings' })
    } else {
      const keymaps: PluginKeymapContribution[] = []
      for (const [index, raw] of value.keymaps.entries()) {
        const at = `contributes.keymaps[${index}]`
        if (!isRecord(raw)) {
          issues.push({ field: at, message: 'must be an object' })
          continue
        }
        const missing = (['mode', 'key', 'action'] as const).find(
          (field) => !isNonEmptyString(raw[field])
        )
        if (missing !== undefined) {
          issues.push({ field: `${at}.${missing}`, message: 'must be a non-empty string' })
          continue
        }
        keymaps.push({
          action: raw.action as string,
          key: raw.key as string,
          mode: raw.mode as string,
        })
      }
      contributions.keymaps = keymaps
    }
  }

  return contributions
}

/**
 * Validates a parsed `aimux-plugin.json`. Collects every issue rather than
 * throwing on the first: an author fixing a manifest wants the whole list.
 */
export function parseManifest(value: unknown): ManifestResult {
  const issues: ManifestIssue[] = []

  if (!isRecord(value)) {
    return { issues: [{ field: '', message: 'manifest must be a JSON object' }], ok: false }
  }

  if (!isNonEmptyString(value.id)) {
    issues.push({ field: 'id', message: 'must be a non-empty string' })
  } else if (!PLUGIN_ID_PATTERN.test(value.id)) {
    issues.push({
      field: 'id',
      message:
        'must be lowercase, dot-separated, at least "<vendor>.<name>" (e.g. "acme.telegram-notify")',
    })
  }

  if (!isNonEmptyString(value.version)) {
    issues.push({ field: 'version', message: 'must be a non-empty version string' })
  }

  if (typeof value.apiVersion !== 'number' || !Number.isInteger(value.apiVersion)) {
    issues.push({
      field: 'apiVersion',
      message: `must be an integer; this aimux implements ${PLUGIN_API_VERSION}`,
    })
  } else if (value.apiVersion !== PLUGIN_API_VERSION) {
    issues.push({
      field: 'apiVersion',
      message: `is ${value.apiVersion}; this aimux implements ${PLUGIN_API_VERSION}`,
    })
  }

  if (value.minAimuxVersion !== undefined && !isNonEmptyString(value.minAimuxVersion)) {
    issues.push({ field: 'minAimuxVersion', message: 'must be a version string when present' })
  }

  const entries = validateEntries(value.entries, issues)
  const config = validateConfigSchema(value.config, issues)
  const build = validateBuild(value.build, issues)
  const commands = validateCommands(value.commands, issues)
  const panes = validatePanes(value.panes, issues)
  const services = validateServices(value.services, issues)
  const contributes = validateContributes(value.contributes, issues)

  const hasHalf =
    entries !== undefined && (entries.ui !== undefined || entries.daemon !== undefined)
  const hasCommands = commands !== undefined && commands.length > 0
  const hasPanes = panes !== undefined && panes.length > 0
  const hasServices = services !== undefined && services.length > 0
  if (!hasHalf && !hasCommands && !hasPanes && !hasServices) {
    issues.push({
      field: 'entries',
      message:
        'a plugin must contribute something: declare entries.ui, entries.daemon, commands[], panes[] or services[]',
    })
  }

  if (issues.length > 0) return { issues, ok: false }

  const manifest: PluginManifest = {
    apiVersion: value.apiVersion as number,
    id: value.id as string,
    version: value.version as string,
  }
  if (isNonEmptyString(value.name)) manifest.name = value.name
  if (isNonEmptyString(value.description)) manifest.description = value.description
  if (isNonEmptyString(value.minAimuxVersion)) manifest.minAimuxVersion = value.minAimuxVersion
  if (entries !== undefined) manifest.entries = entries
  if (build !== undefined) manifest.build = build
  if (config !== undefined) manifest.config = config
  if (commands !== undefined) manifest.commands = commands
  if (panes !== undefined) manifest.panes = panes
  if (services !== undefined) manifest.services = services
  if (contributes !== undefined) manifest.contributes = contributes

  return { manifest, ok: true }
}

export function manifestPath(root: string): string {
  return join(root, PLUGIN_MANIFEST_FILENAME)
}

/** Reads and validates the manifest at `<root>/aimux-plugin.json`. */
export async function readManifest(root: string): Promise<ManifestResult> {
  const path = manifestPath(root)
  const file = Bun.file(path)
  if (!(await file.exists())) {
    return {
      issues: [{ field: '', message: `no ${PLUGIN_MANIFEST_FILENAME} in ${root}` }],
      ok: false,
    }
  }
  let parsed: unknown
  try {
    parsed = await file.json()
  } catch (error) {
    return {
      issues: [
        { field: '', message: `${PLUGIN_MANIFEST_FILENAME} is not valid JSON: ${String(error)}` },
      ],
      ok: false,
    }
  }
  return parseManifest(parsed)
}

/**
 * Host-compatibility checks that need the running aimux version, kept apart
 * from schema validation so `plugin doctor` can report "the manifest is
 * well-formed but needs a newer aimux" as the distinct thing it is.
 */
export function checkHostCompatibility(
  manifest: PluginManifest,
  appVersion: string
): ManifestIssue[] {
  const issues: ManifestIssue[] = []
  if (
    manifest.minAimuxVersion !== undefined &&
    compareVersions(appVersion, manifest.minAimuxVersion) < 0
  ) {
    issues.push({
      field: 'minAimuxVersion',
      message: `requires aimux >= ${manifest.minAimuxVersion}; this is ${appVersion}`,
    })
  }
  return issues
}

export interface ResolvedPluginConfig {
  config: Record<string, unknown>
  issues: ManifestIssue[]
}

/**
 * Merges config sources under the manifest schema. Later sources win, so the
 * order is: schema defaults, then the registry (what `plugin install` and the
 * settings screen write), then `aimux.config.ts` — the file the user edits by
 * hand outranks what a machine wrote.
 *
 * A value of the wrong type is dropped with an issue rather than coerced: a
 * plugin reading `ctx.config.timeout` should never receive the string "30".
 */
export function resolvePluginConfig(
  manifest: PluginManifest,
  ...sources: (Record<string, unknown> | undefined)[]
): ResolvedPluginConfig {
  const schema = manifest.config ?? {}
  const issues: ManifestIssue[] = []
  const config: Record<string, unknown> = {}

  for (const [key, field] of Object.entries(schema)) {
    if (field.default !== undefined) config[key] = field.default
  }

  for (const source of sources) {
    if (!source) continue
    for (const [key, value] of Object.entries(source)) {
      const field = schema[key]
      if (!field) {
        // Unknown keys pass through untouched. A plugin may read config the
        // manifest does not describe; the schema exists to generate settings
        // rows, not to be a wall.
        config[key] = value
        continue
      }
      if (value !== undefined && typeof value !== field.type) {
        issues.push({
          field: `config.${key}`,
          message: `expected ${field.type}, got ${typeof value}`,
        })
        continue
      }
      config[key] = value
    }
  }

  for (const [key, field] of Object.entries(schema)) {
    if (field.required === true && config[key] === undefined) {
      issues.push({ field: `config.${key}`, message: 'is required but has no value' })
    }
  }

  return { config, issues }
}

/** Redacts secrets so a config can be printed by the CLI or the settings screen. */
export function redactPluginConfig(
  manifest: PluginManifest,
  config: Record<string, unknown>
): Record<string, unknown> {
  const schema = manifest.config ?? {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(config)) {
    out[key] = schema[key]?.secret === true && value !== undefined ? '<secret>' : value
  }
  return out
}

export function formatManifestIssues(issues: readonly ManifestIssue[]): string {
  return issues
    .map((issue) => (issue.field === '' ? issue.message : `${issue.field}: ${issue.message}`))
    .join('; ')
}

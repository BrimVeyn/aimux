import type { PluginDefinition, PluginHost, PluginManifest } from '@brimveyn/aimux-plugin'

import type { PluginRecord } from './types'

import { describePluginKeymaps } from './config-origin'
import { formatManifestIssues, parseManifest, resolvePluginConfig } from './manifest'
import { getPluginPaths } from './paths'

/**
 * A plugin that ships inside aimux.
 *
 * Phase 4's premise: a feature aimux already has should be expressible through
 * the plugin API, and whatever cannot be expressed is a hole to fill before
 * anyone outside is asked to build on it. A built-in is therefore not a
 * privileged kind of plugin — it is the same fiber, the same context, the same
 * effect stack, the same reload. It differs in exactly one place: where the
 * definition comes from.
 *
 * There is no directory and no manifest file, because there is no disk. aimux
 * compiles to a single binary; a built-in's code is bundled with it, and its
 * manifest is a literal that is validated by the very same `parseManifest` a
 * third-party one goes through — a malformed built-in manifest fails in CI
 * rather than in a user's terminal.
 */

/**
 * Imports one half. Lazy on purpose: the daemon must never evaluate a UI half,
 * which pulls in React and opentui, and a dynamic import of a static specifier
 * still bundles for `bun build --compile`.
 */
export type BuiltinHalfLoader = () => Promise<PluginDefinition>

export interface BuiltinPlugin {
  /** Same shape as `aimux-plugin.json`, minus `entries` — see `synthesizeEntries`. */
  manifest: Omit<PluginManifest, 'entries'>
  /** The halves this plugin ships. Same two hosts as everyone else. */
  halves: Partial<Record<PluginHost, BuiltinHalfLoader>>
  /**
   * `ctx.config` values taken from aimux's own configuration.
   *
   * A migrated feature usually predates its plugin, and the keys it was
   * configured under are in people's `aimux.config.ts` already. Seeding them
   * here means the plugin body reads nothing but `ctx.config` — exactly like a
   * third-party plugin — while the mapping from the legacy key stays visible
   * in the built-in's declaration, which is where a reader would look for it.
   *
   * Ranks below the user's `plugins: [{ id, config }]` override, above the
   * manifest's own defaults.
   */
  config?: Record<string, unknown>
}

/**
 * The `root` a built-in reports. Not a path — nothing resolves against it —
 * but `aimux plugin list` prints one per plugin, and a plugin that lives in
 * the binary should say so rather than show a directory that does not exist.
 */
export const BUILTIN_ROOT = '<built-in>'

/**
 * `entries` names the file each half loads. A built-in has no files, but the
 * rest of the system reads `entries` to answer "does this plugin have a half
 * for me" — the kernel to decide whether to spawn a fiber, the loader to
 * decide whether to watch. Synthesizing a marker keeps that one question
 * answered in one way for every plugin.
 */
function synthesizeEntries(halves: BuiltinPlugin['halves']): Partial<Record<PluginHost, string>> {
  const entries: Partial<Record<PluginHost, string>> = {}
  for (const host of ['ui', 'daemon'] as const) {
    if (halves[host] !== undefined) entries[host] = `builtin:${host}`
  }
  return entries
}

/** Which layer said `enabled`, for a record that has no registry row of its own. */
export function enabledOrigin(
  fromUserConfig: boolean | undefined,
  fromRegistry: boolean | undefined
): 'default' | 'registry' | 'config' {
  if (fromUserConfig !== undefined) return 'config'
  if (fromRegistry !== undefined) return 'registry'
  return 'default'
}

export interface BuiltinRecordsResult {
  records: PluginRecord[]
  issues: { id: string; message: string }[]
}

/**
 * Turns the shipped list into records the kernel can act on, applying the same
 * config precedence a third-party plugin gets. `aimux.config.ts` is where a
 * built-in is configured or switched off:
 *
 *   plugins: [{ id: 'aimux.claude', enabled: false }]
 *
 * which is the same line that would disable anything else.
 */
export function buildBuiltinRecords(
  builtins: readonly BuiltinPlugin[],
  /** `aimux.config.ts` entries, by id. The hand-written layer; outranks all. */
  userOverrides: ReadonlyMap<
    string,
    { enabled?: boolean; config?: Record<string, unknown>; keymaps?: Record<string, string | null> }
  >,
  /** The registry's `overrides` block: what the settings screen and the CLI write. */
  registryOverrides: ReadonlyMap<
    string,
    {
      enabled?: boolean
      config?: Record<string, unknown>
      keymaps?: Record<string, string | null | undefined>
    }
  >
): BuiltinRecordsResult {
  const records: PluginRecord[] = []
  const issues: BuiltinRecordsResult['issues'] = []

  for (const builtin of builtins) {
    const entries = synthesizeEntries(builtin.halves)
    const parsed = parseManifest({ ...builtin.manifest, entries })
    if (!parsed.ok) {
      // Unreachable short of a coding error, and worth saying loudly when it
      // happens: a built-in with a bad manifest is a broken build, not a
      // broken user setup.
      issues.push({
        id: builtin.manifest.id,
        message: `built-in manifest is invalid: ${formatManifestIssues(parsed.issues)}`,
      })
      continue
    }

    const user = userOverrides.get(parsed.manifest.id)
    const registry = registryOverrides.get(parsed.manifest.id)
    const resolved = resolvePluginConfig(
      parsed.manifest,
      builtin.config,
      registry?.config,
      user?.config
    )
    for (const issue of resolved.issues) {
      issues.push({
        id: parsed.manifest.id,
        message: `${parsed.manifest.id}: ${formatManifestIssues([issue])}`,
      })
    }

    records.push({
      builtin: builtin.halves,
      config: resolved.config,
      enabled: user?.enabled ?? registry?.enabled ?? true,
      enabledFrom: enabledOrigin(user?.enabled, registry?.enabled),
      id: parsed.manifest.id,
      keymaps: describePluginKeymaps(parsed.manifest, {
        ...(registry === undefined ? {} : { override: registry }),
        ...(user?.keymaps === undefined ? {} : { userConfig: user.keymaps }),
      }),
      manifest: parsed.manifest,
      paths: getPluginPaths(parsed.manifest.id, BUILTIN_ROOT),
      root: BUILTIN_ROOT,
      source: 'builtin',
    })
  }

  return { issues, records }
}

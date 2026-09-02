import { mkdirSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { logDebug } from '../debug/input-log'
import { getPluginHotDir } from './paths'

/**
 * Loading a plugin means bundling it, not importing it. See
 * `docs/developer/plugins.md` for the measurements behind that choice; the
 * short version is that Bun's module cache is keyed per resolved file, so a
 * `?v=` cache-buster on the entry reloads the entry and nothing it imports.
 * A two-file plugin would appear not to reload at all.
 *
 * Bundling also gives us the one place where the shared-runtime problem can be
 * solved: the packages below must resolve to *aimux's* copies, or a plugin
 * that renders UI ends up with a second React instance and hooks that throw.
 */

/**
 * Never inlined into the bundle; rewritten to absolute paths under aimux's own
 * root so the plugin and the host share one instance of each.
 */
const SHARED_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  '@opentui/react',
  '@opentui/core',
  '@brimveyn/aimux-plugin',
  '@brimveyn/aimux-config',
  'zustand',
] as const

/** How many build artifacts to keep per plugin. Enough to debug a bad reload. */
const HOT_ARTIFACT_KEEP = 3

const AIMUX_ROOT = new URL('../..', import.meta.url).pathname

export class PluginBuildError extends Error {
  constructor(
    message: string,
    readonly logs: readonly string[]
  ) {
    super(message)
    this.name = 'PluginBuildError'
  }
}

let sharedResolutions: Map<string, string> | null = null

/**
 * Resolved once per process: `Bun.resolveSync` hits the filesystem, and the
 * answer cannot change while aimux is running.
 */
function resolveSharedExternals(): Map<string, string> {
  if (sharedResolutions) return sharedResolutions
  const resolved = new Map<string, string>()
  for (const specifier of SHARED_EXTERNALS) {
    try {
      resolved.set(specifier, Bun.resolveSync(specifier, AIMUX_ROOT))
    } catch {
      // Optional peers (`@opentui/*` in a daemon-only install) simply stay
      // bare; if a plugin actually imports one, the import fails loudly at
      // load time rather than silently resolving to a second copy.
    }
  }
  sharedResolutions = resolved
  return resolved
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Bun emits an external with the specifier the source wrote, whatever
 * `onResolve` answers, so the rewrite has to happen on the generated text.
 * Anchoring on import/export statement positions is safe: a bundle's only
 * remaining bare specifiers are the ones we marked external.
 */
export function rewriteSharedSpecifiers(
  source: string,
  resolutions: ReadonlyMap<string, string>
): string {
  let output = source
  for (const [specifier, absolute] of resolutions) {
    const escaped = escapeRegExp(specifier)
    const fromClause = new RegExp(
      `^(\\s*(?:import|export)\\b[^\\n]*?from\\s*)(["'])${escaped}\\2`,
      'gm'
    )
    const sideEffect = new RegExp(`^(\\s*import\\s*)(["'])${escaped}\\2`, 'gm')
    output = output.replaceAll(fromClause, `$1$2${absolute}$2`)
    output = output.replaceAll(sideEffect, `$1$2${absolute}$2`)
  }
  return output
}

/** Keeps the newest artifacts and deletes the rest. Best-effort. */
function pruneHotArtifacts(hotDir: string): void {
  try {
    const entries = readdirSync(hotDir)
      .filter((name) => name.endsWith('.mjs'))
      .sort()
    for (const name of entries.slice(0, Math.max(0, entries.length - HOT_ARTIFACT_KEEP))) {
      rmSync(join(hotDir, name), { force: true })
    }
  } catch {
    // A missing or unreadable hot dir is not worth failing a load over.
  }
}

export interface BuildPluginEntryOptions {
  pluginId: string
  /** Absolute path to the half's entry file. */
  entryPath: string
  /** Which half — only used to name the artifact readably. */
  half: string
  /** Monotonic per-load counter; makes each artifact a distinct module. */
  revision: number
}

/**
 * Bundles one half and writes the artifact under `<state>/<id>/.hot/`.
 * Returns the artifact path, ready to `import()`.
 */
export async function buildPluginEntry(options: BuildPluginEntryOptions): Promise<string> {
  const built = await Bun.build({
    entrypoints: [options.entryPath],
    external: [...SHARED_EXTERNALS],
    format: 'esm',
    target: 'bun',
  })

  const [output] = built.outputs
  if (!built.success || output === undefined) {
    const logs = built.logs.map((entry) => entry.message)
    throw new PluginBuildError(
      `failed to build ${options.half} half of ${options.pluginId}: ${logs.join('; ') || 'unknown build error'}`,
      logs
    )
  }

  const source = await output.text()
  const rewritten = rewriteSharedSpecifiers(source, resolveSharedExternals())

  const hotDir = getPluginHotDir(options.pluginId)
  mkdirSync(hotDir, { recursive: true })
  // Zero-padded so lexical order is load order, which is what the pruner reads.
  const artifactPath = join(
    hotDir,
    `${options.half}-${String(options.revision).padStart(6, '0')}.mjs`
  )
  await Bun.write(artifactPath, rewritten)
  pruneHotArtifacts(hotDir)

  // Canonicalised before it is handed back. Bun resolves an import specifier
  // against a cached directory listing keyed by the *real* path, so on a
  // machine where the state directory sits behind a symlink — every macOS
  // `/var/...` temp dir, and any `~` on a linked home — an artifact written
  // after that listing was first taken resolves as "Cannot find module" even
  // though it is right there. That is every reload after the first.
  return realpathSync(artifactPath)
}

export interface LoadedPluginModule {
  /** The module's default export — expected to be a `definePlugin` result. */
  definition: unknown
  artifactPath: string
}

/**
 * Builds and imports one half. Every failure — a syntax error, a missing
 * import, a module that throws at top level — surfaces as a rejection the
 * fiber turns into `FAILED`, never as a crash of the host process.
 */
export async function loadPluginEntry(
  options: BuildPluginEntryOptions
): Promise<LoadedPluginModule> {
  const started = performance.now()
  const artifactPath = await buildPluginEntry(options)
  // A `file://` URL, not the bare path. Bun resolves a bare absolute specifier
  // through a cached directory listing, so an artifact written after the
  // directory was first read resolves as "Cannot find module" even though it is
  // right there — which is every reload after the first. A URL skips resolution.
  const module = (await import(pathToFileURL(artifactPath).href)) as { default?: unknown }
  logDebug('plugin.module.loaded', {
    artifactPath,
    half: options.half,
    ms: Math.round(performance.now() - started),
    pluginId: options.pluginId,
  })
  return { artifactPath, definition: module.default }
}

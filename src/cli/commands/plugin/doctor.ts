import { createTestContext, type PluginDefinition, type PluginHost } from '@brimveyn/aimux-plugin'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import type { CliCommand } from '../../registry'

import { version as APP_VERSION } from '../../../../package.json'
import {
  checkHostCompatibility,
  formatManifestIssues,
  readManifest,
  resolvePluginConfig,
} from '../../../plugins/manifest'
import { loadPluginEntry } from '../../../plugins/module-loader'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, EXIT_RUNTIME, writeError, writeJson } from '../../output'
import { findRegistryEntry, resolvePluginRoot } from './shared'

/**
 * The tool an author — or the agent writing the plugin — runs in a loop.
 * Everything it reports names the thing that is wrong precisely enough to fix
 * without guessing: the manifest field, the build log, the half that failed to
 * apply.
 *
 * `doctor` is the one command that does execute plugin code, and it says so.
 * It applies each half against `createTestContext()`, so the registrations it
 * lists are the real ones while nothing touches the running aimux.
 */

interface HalfReport {
  host: PluginHost
  entry: string
  built: boolean
  applied: boolean
  /** What `apply` registered against the sandbox context. */
  registrations?: { effects: number; events: string[]; rpcVerbs: string[]; services: string[] }
  error?: string
}

async function checkHalf(
  pluginId: string,
  root: string,
  host: PluginHost,
  entry: string,
  config: Record<string, unknown>,
  apply: boolean
): Promise<HalfReport> {
  const report: HalfReport = { applied: false, built: false, entry, host }
  let definition: PluginDefinition
  try {
    const loaded = await loadPluginEntry({
      entryPath: join(root, entry),
      half: `doctor-${host}`,
      pluginId,
      revision: Date.now(),
    })
    report.built = true
    definition = loaded.definition as PluginDefinition
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error)
    return report
  }

  if (
    typeof definition !== 'object' ||
    definition === null ||
    typeof definition.apply !== 'function'
  ) {
    report.error = `entry must default-export definePlugin({ apply }) — got ${typeof definition}`
    return report
  }

  if (!apply) return report

  const harness = createTestContext({ config, host, id: pluginId })
  try {
    await harness.apply(definition)
    report.applied = true
    report.registrations = {
      effects: harness.effectCount(),
      events: harness.bus.events(),
      rpcVerbs: harness.handledVerbs(),
      services: [...harness.provided.keys()],
    }
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error)
  } finally {
    await harness.dispose()
  }
  return report
}

/** `tsc --noEmit` in the plugin, when it ships a tsconfig. Advisory. */
async function checkTypes(root: string): Promise<{ ran: boolean; ok?: boolean; output?: string }> {
  if (!existsSync(join(root, 'tsconfig.json'))) return { ran: false }
  try {
    const proc = Bun.spawn(['bunx', 'tsc', '--noEmit'], {
      cwd: root,
      stderr: 'pipe',
      stdout: 'pipe',
    })
    const exitCode = await proc.exited
    const output = `${await new Response(proc.stdout).text()}${await new Response(proc.stderr).text()}`
    return { ok: exitCode === 0, output: output.trim().slice(0, 2000), ran: true }
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error), ran: true }
  }
}

export const pluginDoctor: CliCommand = {
  args: [{ complete: { kind: 'file' }, name: 'path-or-id' }],
  flags: [
    ...SHARED_FLAGS,
    {
      description: 'Validate the manifest only; do not build or apply',
      kind: 'boolean',
      name: 'no-apply',
    },
    { description: 'Skip the `tsc --noEmit` pass', kind: 'boolean', name: 'no-types' },
  ],
  group: 'plugin',
  run: async (ctx) => {
    const target = ctx.args.positionals[0] ?? '.'
    // A bare id is looked up in the registry so `plugin doctor acme.x` works
    // from anywhere, not just from inside the checkout.
    const registered = findRegistryEntry(target)
    const root = registered ? registered.path : resolvePluginRoot(target)

    const manifestResult = await readManifest(root)
    if (!manifestResult.ok) {
      writeError(`${root}: ${formatManifestIssues(manifestResult.issues)}`)
      writeJson({ issues: manifestResult.issues, ok: false, root })
      return EXIT_RUNTIME
    }
    const { manifest } = manifestResult

    const compatibility = checkHostCompatibility(manifest, APP_VERSION)
    const configResult = resolvePluginConfig(manifest, registered?.config)
    const issues = [...compatibility, ...configResult.issues]

    const halves: HalfReport[] = []
    const doApply = ctx.args.flags['no-apply'] !== true
    for (const host of ['ui', 'daemon'] as const) {
      const entry = manifest.entries?.[host]
      if (entry === undefined) continue
      halves.push(await checkHalf(manifest.id, root, host, entry, configResult.config, doApply))
    }

    const types = ctx.args.flags['no-types'] === true ? { ran: false } : await checkTypes(root)

    const ok =
      issues.length === 0 && halves.every((half) => half.error === undefined) && types.ok !== false

    writeJson({
      aimuxVersion: APP_VERSION,
      halves,
      id: manifest.id,
      issues,
      manifest,
      ok,
      registered: registered !== undefined,
      root,
      types,
      version: manifest.version,
    })
    if (!ok) {
      for (const issue of issues) writeError(`${issue.field}: ${issue.message}`)
      for (const half of halves) {
        if (half.error !== undefined) writeError(`${half.host} half: ${half.error}`)
      }
      if (types.ok === false) writeError('tsc --noEmit reported errors (see `types.output`)')
    }
    return ok ? EXIT_OK : EXIT_RUNTIME
  },
  summary: 'Validate a plugin: manifest, build, dry apply, types',
  verb: 'doctor',
}

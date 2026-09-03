import type { PluginManifest } from '@brimveyn/aimux-plugin'

import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import type { CliCommand } from '../../registry'

import { type PluginBuildResult, runPluginBuild } from '../../../plugins/build'
import { formatManifestIssues, readManifest } from '../../../plugins/manifest'
import { getInstalledPluginDir, getPluginsRootDir } from '../../../plugins/paths'
import { upsertPluginRegistryEntry } from '../../../plugins/registry-file'
import { CliUsageError, SHARED_FLAGS } from '../../flags'
import { EXIT_OK, EXIT_RUNTIME, EXIT_USAGE, writeError, writeJson } from '../../output'
import { notifyRunningDaemon } from './shared'

/**
 * `owner/repo` or `owner/repo/sub/dir`. Deliberately not a URL: v1 installs
 * from GitHub only, and accepting a URL would imply support for arbitrary
 * hosts that the clone path does not have.
 */
const SPEC_PATTERN = /^([\w.-]+)\/([\w.-]+)(?:\/(.+))?$/

export interface ParsedSpec {
  owner: string
  repo: string
  subdir?: string
}

export function formatInstallSpec(spec: ParsedSpec): string {
  return `${spec.owner}/${spec.repo}${spec.subdir === undefined ? '' : `/${spec.subdir}`}`
}

export function parseInstallSpec(spec: string): ParsedSpec {
  const match = SPEC_PATTERN.exec(spec.trim())
  if (!match) {
    throw new CliUsageError(`expected "owner/repo" or "owner/repo/subdir", got "${spec}"`)
  }
  const [, owner = '', repo = '', subdir] = match
  return subdir === undefined ? { owner, repo } : { owner, repo, subdir }
}

/**
 * Clone into a staging directory and read the manifest there. The caller
 * owns `staging` and removes it — install after copying, update after
 * comparing versions.
 */
export async function fetchPluginFromGitHub(spec: ParsedSpec): Promise<{
  staging: string
  root: string
  manifest: PluginManifest | null
  issues: string | null
}> {
  mkdirSync(getPluginsRootDir(), { recursive: true })
  const staging = join(getPluginsRootDir(), `.staging-${Date.now()}`)
  rmSync(staging, { force: true, recursive: true })
  await cloneShallow(spec, staging)
  const root = spec.subdir === undefined ? staging : join(staging, spec.subdir)
  const result = await readManifest(root)
  return result.ok
    ? { issues: null, manifest: result.manifest, root, staging }
    : { issues: formatManifestIssues(result.issues), manifest: null, root, staging }
}

/**
 * Copies a fetched checkout into `<profile>/plugins/<id>`, runs `build`, and
 * records it. A failed build removes the copy: an installed plugin that
 * cannot load is worse than one that is not installed.
 */
export async function placeInstalledPlugin(
  root: string,
  manifest: PluginManifest,
  origin: string
): Promise<{ target: string; build: PluginBuildResult }> {
  const target = getInstalledPluginDir(manifest.id)
  if (existsSync(target)) rmSync(target, { force: true, recursive: true })
  mkdirSync(target, { recursive: true })
  // `cp -R <root>/. <target>` keeps the subdir case simple and preserves
  // dotfiles, which a glob copy would miss.
  const copy = Bun.spawn(['cp', '-R', `${root}/.`, target], { stderr: 'pipe' })
  if ((await copy.exited) !== 0) {
    throw new Error(`failed to copy plugin into ${target}`)
  }
  const build = await runPluginBuild(manifest, target)
  if (build.failed !== undefined) {
    rmSync(target, { force: true, recursive: true })
    return { build, target }
  }
  upsertPluginRegistryEntry({
    enabled: true,
    id: manifest.id,
    origin,
    path: target,
    source: 'install',
    version: manifest.version,
  })
  return { build, target }
}

async function cloneShallow(spec: ParsedSpec, into: string): Promise<void> {
  const url = `https://github.com/${spec.owner}/${spec.repo}.git`
  const proc = Bun.spawn(['git', 'clone', '--depth', '1', url, into], {
    stderr: 'pipe',
    stdout: 'pipe',
  })
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`git clone failed (${exitCode}): ${stderr.trim().slice(0, 500)}`)
  }
}

/**
 * Clone, preview, confirm, build, register — herdr's flow.
 *
 * The confirmation is load-bearing rather than ceremonial: `build` runs
 * arbitrary commands with the user's privileges, and there is no sandbox. In a
 * non-interactive session the command refuses instead of assuming consent,
 * which is why `--yes` exists.
 */
export const pluginInstall: CliCommand = {
  args: [{ complete: { kind: 'none' }, name: 'spec', required: true }],
  flags: [
    ...SHARED_FLAGS,
    {
      description: 'Install without confirming (required when stdin is not a TTY)',
      kind: 'boolean',
      name: 'yes',
    },
    { description: 'Print the manifest and stop', kind: 'boolean', name: 'dry-run' },
  ],
  group: 'plugin',
  run: async (ctx) => {
    const spec = parseInstallSpec(ctx.args.positionals[0] ?? '')
    const origin = formatInstallSpec(spec)

    const fetched = await fetchPluginFromGitHub(spec)
    const { root, staging } = fetched
    try {
      if (fetched.manifest === null) {
        writeError(`${origin}: ${fetched.issues ?? 'invalid manifest'}`)
        writeJson({ error: fetched.issues, kind: 'invalid-manifest', origin })
        return EXIT_RUNTIME
      }
      const { manifest } = fetched

      // Preview on stderr: stdout stays one JSON object, per the CLI contract.
      writeError(`about to install ${manifest.id}@${manifest.version} from ${origin}`)
      writeError(`  halves: ${Object.keys(manifest.entries ?? {}).join(', ') || 'none'}`)
      writeError(
        `  build:  ${(manifest.build ?? []).map((step) => step.join(' ')).join(' && ') || 'none'}`
      )
      writeError('  plugin code runs with your privileges; there is no sandbox.')

      if (ctx.args.flags['dry-run'] === true) {
        writeJson({ dryRun: true, manifest, origin })
        return EXIT_OK
      }

      if (ctx.args.flags.yes !== true) {
        writeError('refusing to install without --yes')
        writeJson({ error: 'confirmation required', kind: 'needs-confirmation', manifest, origin })
        return EXIT_USAGE
      }

      const { build, target } = await placeInstalledPlugin(root, manifest, origin)
      if (build.failed !== undefined) {
        writeError(`build step failed: ${build.failed}`)
        writeJson({ error: build.failed, id: manifest.id, kind: 'build-failed', origin })
        return EXIT_RUNTIME
      }

      const refreshed = await notifyRunningDaemon('refresh')
      writeJson({
        build,
        daemon: refreshed.ok ? 'refreshed' : (refreshed.detail ?? 'unreachable'),
        id: manifest.id,
        installed: true,
        origin,
        root: target,
        version: manifest.version,
      })
      return EXIT_OK
    } finally {
      rmSync(staging, { force: true, recursive: true })
    }
  },
  summary: 'Install a plugin from GitHub (owner/repo[/subdir])',
  verb: 'install',
}

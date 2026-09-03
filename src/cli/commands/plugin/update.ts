import { rmSync } from 'node:fs'

import type { CliCommand } from '../../registry'

import { compareVersions } from '../../../plugins/manifest'
import { loadPluginRegistryResult } from '../../../plugins/registry-file'
import { SHARED_FLAGS } from '../../flags'
import { EXIT_OK, EXIT_RUNTIME, writeError, writeJson } from '../../output'
import { fetchPluginFromGitHub, parseInstallSpec, placeInstalledPlugin } from './install'
import { notifyRunningDaemon } from './shared'

interface UpdateReport {
  id: string
  origin: string
  from: string | undefined
  to: string | null
  updated: boolean
  reason?: string
}

/**
 * Re-fetches an installed plugin from where it came and replaces the copy
 * when the manifest version moved. Linked plugins are the user's checkouts
 * and are left alone; a plugin with no `origin` predates the field and is
 * reported rather than guessed at.
 *
 * `--yes` is required for the same reason `install` requires it: `build`
 * runs with the user's privileges, and a newer version is new code.
 */
async function updateOne(
  entry: { id: string; origin?: string; version?: string },
  options: { yes: boolean; force: boolean }
): Promise<UpdateReport> {
  const base: UpdateReport = {
    from: entry.version,
    id: entry.id,
    origin: entry.origin ?? '',
    to: null,
    updated: false,
  }
  if (entry.origin === undefined) {
    return { ...base, reason: 'no origin recorded — reinstall once with `aimux plugin install`' }
  }
  const fetched = await fetchPluginFromGitHub(parseInstallSpec(entry.origin))
  try {
    if (fetched.manifest === null) {
      return { ...base, reason: `upstream manifest is invalid: ${fetched.issues ?? ''}` }
    }
    const { manifest } = fetched
    const to = manifest.version
    if (manifest.id !== entry.id) {
      return { ...base, reason: `upstream now holds "${manifest.id}", not "${entry.id}"`, to }
    }
    const newer =
      entry.version === undefined || compareVersions(to, entry.version) > 0 || options.force
    if (!newer) return { ...base, reason: 'already up to date', to }
    if (!options.yes) {
      return {
        ...base,
        reason: 'a newer version is available — rerun with --yes to install it',
        to,
      }
    }
    const { build } = await placeInstalledPlugin(fetched.root, manifest, entry.origin)
    if (build.failed !== undefined) {
      return { ...base, reason: `build step failed: ${build.failed}`, to }
    }
    return { ...base, to, updated: true }
  } finally {
    rmSync(fetched.staging, { force: true, recursive: true })
  }
}

export const pluginUpdate: CliCommand = {
  args: [{ complete: { kind: 'dynamic', source: 'plugin' }, name: 'id' }],
  flags: [
    ...SHARED_FLAGS,
    { description: 'Install newer versions without confirming', kind: 'boolean', name: 'yes' },
    {
      description: 'Reinstall even when the version has not changed',
      kind: 'boolean',
      name: 'force',
    },
  ],
  group: 'plugin',
  run: async (ctx) => {
    const id = ctx.args.positionals[0]
    const installed = loadPluginRegistryResult().registry.plugins.filter(
      (entry) => entry.source === 'install' && (id === undefined || entry.id === id)
    )
    if (id !== undefined && installed.length === 0) {
      writeError(`"${id}" is not an installed plugin — linked checkouts update themselves`)
      writeJson({ error: 'not an installed plugin', id, kind: 'wrong-source' })
      return EXIT_RUNTIME
    }
    const options = { force: ctx.args.flags.force === true, yes: ctx.args.flags.yes === true }
    const reports: UpdateReport[] = []
    for (const entry of installed) {
      try {
        reports.push(await updateOne(entry, options))
      } catch (error) {
        reports.push({
          from: entry.version,
          id: entry.id,
          origin: entry.origin ?? '',
          reason: error instanceof Error ? error.message : String(error),
          to: null,
          updated: false,
        })
      }
    }
    const anyUpdated = reports.some((report) => report.updated)
    const refreshed = anyUpdated ? await notifyRunningDaemon('refresh') : null
    for (const report of reports) {
      if (report.reason !== undefined) writeError(`${report.id}: ${report.reason}`)
    }
    let daemon = 'untouched'
    if (refreshed !== null)
      daemon = refreshed.ok ? 'refreshed' : (refreshed.detail ?? 'unreachable')
    writeJson({ daemon, plugins: reports })
    return EXIT_OK
  },
  summary: 'Re-fetch installed plugins and replace the ones that moved on',
  verb: 'update',
}

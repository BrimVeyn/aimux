import type { PluginManifest } from '@brimveyn/aimux-plugin'

import { logDebug } from '../debug/input-log'

/**
 * Runs a manifest's `build` steps — in practice `bun install`, occasionally a
 * codegen pass. Steps are argv arrays, never shell strings: there is no
 * quoting to get wrong and no shell to inject into.
 *
 * This is still arbitrary code execution with the user's privileges, which is
 * why `plugin install` shows the manifest and asks before reaching here, and
 * why `plugin link` runs it only on a directory the user named themselves.
 */

const BUILD_STEP_TIMEOUT_MS = 300_000

export interface PluginBuildResult {
  ran: string[]
  skipped?: boolean
  /** Set when a step exited non-zero; the remaining steps do not run. */
  failed?: string
}

export async function runPluginBuild(
  manifest: PluginManifest,
  root: string
): Promise<PluginBuildResult> {
  const steps = manifest.build ?? []
  if (steps.length === 0) return { ran: [] }

  const ran: string[] = []
  for (const argv of steps) {
    const label = argv.join(' ')
    logDebug('plugin.build.step', { argv: label, pluginId: manifest.id })
    try {
      const proc = Bun.spawn(argv, {
        cwd: root,
        stderr: 'pipe',
        stdout: 'pipe',
      })
      const timer = setTimeout(() => {
        proc.kill()
      }, BUILD_STEP_TIMEOUT_MS)
      const exitCode = await proc.exited
      clearTimeout(timer)
      if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text()
        return { failed: `${label} exited ${exitCode}: ${stderr.trim().slice(0, 500)}`, ran }
      }
      ran.push(label)
    } catch (error) {
      return { failed: `${label}: ${error instanceof Error ? error.message : String(error)}`, ran }
    }
  }
  return { ran }
}

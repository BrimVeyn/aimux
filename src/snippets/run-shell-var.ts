import type { SnippetShellVar } from '@brimveyn/aimux-config'

import { logDebug } from '../debug/input-log'

const DEFAULT_TIMEOUT_MS = 5000
/** Hard ceiling on any user-supplied timeout to prevent runaway expansions. */
const MAX_TIMEOUT_MS = 30_000

/**
 * Build the shell argv. We default to `$SHELL -l -c <cmd>` so the user's
 * login shell rc files (e.g. /etc/zprofile → path_helper on macOS) populate
 * PATH and make tools like `gh`, `jira`, `brew` resolvable — matching
 * Espanso's behavior. Falls back to `/bin/sh -c` if SHELL is unset.
 */
function buildShellArgv(cmd: string): string[] {
  const userShell = process.env.SHELL
  if (userShell && userShell.length > 0) {
    return [userShell, '-l', '-c', cmd]
  }
  return ['/bin/sh', '-c', cmd]
}

/**
 * Run a snippet shell var via the user's login shell, capture stdout.
 *
 * Returns the trimmed stdout on success, or '' on error / timeout / non-zero
 * exit. Stderr is captured for logging but never propagated into the result —
 * snippet content is for the terminal, not for surfacing failures.
 */
export async function runShellVar(name: string, v: SnippetShellVar): Promise<string> {
  const requested = v.timeout ?? DEFAULT_TIMEOUT_MS
  const timeoutMs = Math.min(Math.max(requested, 0), MAX_TIMEOUT_MS)

  let proc: Bun.Subprocess<'ignore', 'pipe', 'pipe'>
  try {
    proc = Bun.spawn(buildShellArgv(v.sh), {
      stderr: 'pipe',
      stdin: 'ignore',
      stdout: 'pipe',
    })
  } catch (error) {
    logDebug('snippets.shellVar.spawnError', {
      cmd: v.sh,
      error: error instanceof Error ? error.message : String(error),
      name,
    })
    return ''
  }

  let timeoutFired = false
  const timeoutHandle = setTimeout(() => {
    timeoutFired = true
    try {
      proc.kill()
    } catch {
      // process already gone
    }
  }, timeoutMs)

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    if (timeoutFired) {
      logDebug('snippets.shellVar.timeout', { cmd: v.sh, name, timeoutMs })
      return ''
    }

    if (exitCode !== 0) {
      logDebug('snippets.shellVar.nonZeroExit', {
        cmd: v.sh,
        exitCode,
        name,
        stderr: stderr.slice(0, 200),
      })
      return ''
    }

    return v.trim === false ? stdout : stdout.replace(/\s+$/, '')
  } catch (error) {
    logDebug('snippets.shellVar.error', {
      cmd: v.sh,
      error: error instanceof Error ? error.message : String(error),
      name,
    })
    return ''
  } finally {
    clearTimeout(timeoutHandle)
  }
}

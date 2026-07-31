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
  if (userShell != null && userShell !== '' && userShell.length > 0) {
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

  // Racing the timeout rather than checking a flag after the reads: `proc.kill()`
  // signals the shell, but a command it forked instead of exec'ing outlives it
  // still holding the stdout pipe, so reading to EOF blocks past the deadline —
  // on Linux `sleep 5` behind an 80ms timeout waited the full five seconds.
  // ponytail: the orphan is left running. Kill the process group if a snippet
  // ever spawns something expensive enough to care about.
  let timeoutFired = false
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<'timeout'>((resolve) => {
    timeoutHandle = setTimeout(() => {
      timeoutFired = true
      try {
        proc.kill()
      } catch {
        // process already gone
      }
      resolve('timeout')
    }, timeoutMs)
  })

  // Swallow inside, not with a trailing `.catch`: the loser of the race below
  // is still a live promise, and a late failure would otherwise surface as an
  // unhandled rejection long after we returned.
  const collected = (async (): Promise<[string, string, number] | 'failed'> => {
    try {
      return await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])
    } catch (error) {
      logDebug('snippets.shellVar.error', {
        cmd: v.sh,
        error: error instanceof Error ? error.message : String(error),
        name,
      })
      return 'failed'
    }
  })()

  try {
    const outcome = await Promise.race([collected, expired])

    if (outcome === 'timeout' || timeoutFired) {
      logDebug('snippets.shellVar.timeout', { cmd: v.sh, name, timeoutMs })
      return ''
    }
    if (outcome === 'failed') return ''
    const [stdout, stderr, exitCode] = outcome

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

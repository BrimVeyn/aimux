interface CliResult {
  ok: boolean
  stdout: string
  stderr: string
  error?: string
}

const DEFAULT_TIMEOUT_MS = 15_000

export async function runCli(
  command: string,
  args: string[],
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  cwd?: string
): Promise<CliResult> {
  let proc: Bun.Subprocess<'ignore', 'pipe', 'pipe'>
  try {
    proc = Bun.spawn([command, ...args], {
      cwd,
      stderr: 'pipe',
      stdin: 'ignore',
      stdout: 'pipe',
    })
  } catch (error) {
    // posix_spawn throws — synchronously — for a missing binary AND for a cwd
    // that no longer exists (a deleted project dir or a pruned worktree), and
    // it names the binary in both. Uncaught, that took the whole app down.
    return {
      error: `${command}: ${String(error)}`.slice(0, 200),
      ok: false,
      stderr: '',
      stdout: '',
    }
  }

  const timeout = setTimeout(() => {
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

    if (exitCode !== 0) {
      return {
        error: `${command} exit ${exitCode}: ${stderr.trim().slice(0, 200)}`,
        ok: false,
        stderr,
        stdout,
      }
    }

    return { ok: true, stderr, stdout }
  } finally {
    clearTimeout(timeout)
  }
}

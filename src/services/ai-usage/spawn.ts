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
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<CliResult> {
  const proc = Bun.spawn([command, ...args], {
    stderr: 'pipe',
    stdin: 'ignore',
    stdout: 'pipe',
  })

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

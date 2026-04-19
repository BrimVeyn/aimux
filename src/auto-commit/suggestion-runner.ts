import type { HeadlessInvocation } from './headless-commands'

import { type ParsedSuggestion, parseSuggestion } from './output-parser'

export type SpawnFn = (
  invocation: HeadlessInvocation,
  signal: AbortSignal
) => Promise<{ stdout: string; exitCode: number } | null>

export interface RunOptions {
  invocation: HeadlessInvocation
  signal: AbortSignal
  timeoutMs: number
  spawn?: SpawnFn
}

export async function runSuggestion(opts: RunOptions): Promise<ParsedSuggestion | null> {
  const spawnFn = opts.spawn ?? defaultSpawn
  const composite = AbortSignal.any([opts.signal, AbortSignal.timeout(opts.timeoutMs)])
  try {
    const result = await spawnFn(opts.invocation, composite)
    if (!result) return null
    if (result.exitCode !== 0) return null
    return parseSuggestion(result.stdout)
  } catch {
    return null
  }
}

async function defaultSpawn(
  invocation: HeadlessInvocation,
  signal: AbortSignal
): Promise<{ stdout: string; exitCode: number } | null> {
  try {
    const proc = Bun.spawn([invocation.executable, ...invocation.args], {
      stderr: 'ignore',
      stdin: 'ignore',
      stdout: 'pipe',
    })
    const onAbort = () => {
      try {
        proc.kill()
      } catch {
        // ignore
      }
    }
    signal.addEventListener('abort', onAbort, { once: true })
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    signal.removeEventListener('abort', onAbort)
    if (signal.aborted) return null
    return { exitCode: exitCode ?? 1, stdout }
  } catch {
    return null
  }
}

import { buildHeadlessInvocation, type HeadlessInvocation } from '../auto-commit/headless-commands'
import { clampTitle } from './title-format'

export type TitleSpawnFn = (
  invocation: HeadlessInvocation,
  signal: AbortSignal
) => Promise<{ stdout: string; exitCode: number } | null>

/**
 * `failed` is retryable — a later prompt may well produce a usable title.
 * `unavailable` is not: the provider has no headless mode or its binary is not
 * installed, so the coordinator should stop burning attempts and fall back.
 */
export type TitleResult =
  | { status: 'ok'; title: string }
  | { status: 'failed' }
  | { status: 'unavailable' }

export function buildTitlePrompt(firstPrompt: string): string {
  return [
    'Create a concise tab title for the user request below.',
    'Return only the title: 2 to 6 words, at most 48 characters, in the same language as the request.',
    'Do not use quotes, a label, markdown, or ending punctuation.',
    '',
    firstPrompt.slice(0, 8_000),
  ].join('\n')
}

export function sanitizeGeneratedTitle(raw: string): string | null {
  const first = raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean)
  if (first == null || first === '') return null

  const unlabelled = first.replace(/^TITLE\s*:\s*/iu, '').replaceAll(/^["'“”‘’]+|["'“”‘’]+$/gu, '')
  return clampTitle(unlabelled)
}

function executableOnPath(executable: string): boolean {
  try {
    return typeof Bun !== 'undefined' && Bun.which(executable) != null
  } catch {
    // Never let a lookup failure mask a provider that would have worked.
    return true
  }
}

export async function generateTabTitle(options: {
  provider: string
  model?: string
  firstPrompt: string
  timeoutMs: number
  signal: AbortSignal
  spawn?: TitleSpawnFn
  isExecutableAvailable?: (executable: string) => boolean
}): Promise<TitleResult> {
  const invocation = buildHeadlessInvocation(
    options.provider,
    buildTitlePrompt(options.firstPrompt),
    options.model
  )
  if (!invocation) return { status: 'unavailable' }

  // A caller-supplied spawn does not go through PATH, so only probe it for the
  // real one. Probing lets a missing CLI fail instantly instead of after the
  // full timeout, once per tab instead of once per attempt.
  const available = options.isExecutableAvailable ?? (options.spawn ? null : executableOnPath)
  if (available && !available(invocation.executable)) return { status: 'unavailable' }

  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)])
  try {
    const result = await (options.spawn ?? defaultSpawn)(invocation, signal)
    if (!result || result.exitCode !== 0 || signal.aborted) return { status: 'failed' }
    const title = sanitizeGeneratedTitle(result.stdout)
    return title == null ? { status: 'failed' } : { status: 'ok', title }
  } catch {
    return { status: 'failed' }
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
    const abort = () => {
      try {
        proc.kill()
      } catch {
        // Best effort: the process may already have exited.
      }
    }
    signal.addEventListener('abort', abort, { once: true })
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    signal.removeEventListener('abort', abort)
    if (signal.aborted) return null
    return { exitCode: exitCode ?? 1, stdout }
  } catch {
    return null
  }
}

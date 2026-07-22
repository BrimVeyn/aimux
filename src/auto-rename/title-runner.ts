import { buildHeadlessInvocation, type HeadlessInvocation } from '../auto-commit/headless-commands'

export type TitleSpawnFn = (
  invocation: HeadlessInvocation,
  signal: AbortSignal
) => Promise<{ stdout: string; exitCode: number } | null>

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
  const clean = unlabelled
    .replaceAll(/\s+/gu, ' ')
    .replace(/[.!?,;:…]+$/u, '')
    .trim()
  const words = clean.split(' ').filter(Boolean)
  const usesUnspacedScript = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(clean)
  if (words.length < 2 && !usesUnspacedScript) return null

  let title = words.slice(0, 6).join(' ')
  if (title.length > 48) {
    title = title
      .slice(0, 48)
      .replace(/\s+\S*$/u, '')
      .trim()
  }
  return title === '' || (title.split(' ').filter(Boolean).length < 2 && !usesUnspacedScript)
    ? null
    : title
}

export async function generateTabTitle(options: {
  provider: string
  model?: string
  firstPrompt: string
  timeoutMs: number
  signal: AbortSignal
  spawn?: TitleSpawnFn
}): Promise<string | null> {
  const invocation = buildHeadlessInvocation(
    options.provider,
    buildTitlePrompt(options.firstPrompt),
    options.model
  )
  if (!invocation) return null

  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)])
  try {
    const result = await (options.spawn ?? defaultSpawn)(invocation, signal)
    if (!result || result.exitCode !== 0 || signal.aborted) return null
    return sanitizeGeneratedTitle(result.stdout)
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

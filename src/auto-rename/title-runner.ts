import { buildHeadlessInvocation, type HeadlessInvocation } from '../auto-commit/headless-commands'
import { foldDiacritics } from '../platform/worktree-paths'
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

/**
 * A workspace needs two different names from one request: a tab title in the
 * user's own language, and a branch name — which is read by git, by reviewers
 * and by CI, so it follows the repo's conventions instead: English, a
 * conventional-commit type, kebab-case. `branch` is null when the model gave
 * nothing that qualifies; the caller keeps the branch it already has.
 */
export type NamingResult =
  | { status: 'ok'; title: string; branch: string | null }
  | { status: 'failed' }
  | { status: 'unavailable' }

/** Conventional-commit types a generated branch may use; anything else is refused. */
const BRANCH_TYPES = new Set([
  'build',
  'chore',
  'ci',
  'docs',
  'feat',
  'fix',
  'perf',
  'refactor',
  'style',
  'test',
])
const BRANCH_SUBJECT_WORDS = 5

export function buildTitlePrompt(firstPrompt: string): string {
  return [
    'Create a concise tab title for the user request below.',
    'Return only the title: 2 to 6 words, at most 48 characters, in the same language as the request.',
    'Do not use quotes, a label, markdown, or ending punctuation.',
    '',
    firstPrompt.slice(0, 8_000),
  ].join('\n')
}

export function buildWorkspaceNamingPrompt(firstPrompt: string): string {
  return [
    'Name a workspace for the user request below.',
    'Return exactly two lines and nothing else.',
    'Line 1 — a tab title: 2 to 6 words, at most 48 characters, in the same language as the request.',
    'Line 2 — a git branch named <type>/<subject>, always in English whatever the language of the request.',
    '<type> is one of: feat, fix, refactor, perf, docs, test, chore, ci, style, build.',
    '<subject> is 2 to 5 lowercase words joined by hyphens, naming what changes rather than restating the request.',
    'Example line 2: fix/scroll-drift-on-resize',
    'No quotes, no labels, no numbering, no markdown, no ending punctuation.',
    '',
    firstPrompt.slice(0, 8_000),
  ].join('\n')
}

function nonEmptyLines(raw: string): string[] {
  return raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
}

/** Strip the wrappers a model reaches for even when told not to: labels, list markers, quotes. */
function unwrapLine(line: string, label: RegExp): string {
  return line
    .replace(label, '')
    .replace(/^(?:\d+[.)]|[-*])\s*/u, '')
    .replaceAll(/^["'`“”‘’]+|["'`“”‘’]+$/gu, '')
}

export function sanitizeGeneratedTitle(raw: string): string | null {
  const first = nonEmptyLines(raw)[0]
  if (first == null) return null
  return clampTitle(unwrapLine(first, /^TITLE\s*:\s*/iu))
}

export function sanitizeGeneratedBranch(raw: string): string | null {
  const line = unwrapLine(raw.trim(), /^BRANCH\s*:\s*/iu)
  const slash = line.indexOf('/')
  if (slash < 0) return null
  const type = line.slice(0, slash).trim().toLowerCase()
  if (!BRANCH_TYPES.has(type)) return null
  // Whole words only: a mid-word cut ("...-bran") names nothing.
  const subject = foldDiacritics(line.slice(slash + 1))
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean)
    .slice(0, BRANCH_SUBJECT_WORDS)
    .join('-')
  return subject === '' ? null : `${type}/${subject}`
}

function executableOnPath(executable: string): boolean {
  try {
    return typeof Bun !== 'undefined' && Bun.which(executable) != null
  } catch {
    // Never let a lookup failure mask a provider that would have worked.
    return true
  }
}

export interface NamingOptions {
  provider: string
  model?: string
  firstPrompt: string
  timeoutMs: number
  signal: AbortSignal
  spawn?: TitleSpawnFn
  isExecutableAvailable?: (executable: string) => boolean
}

async function runNamingModel(
  options: NamingOptions,
  prompt: string
): Promise<{ status: 'ok'; stdout: string } | { status: 'failed' } | { status: 'unavailable' }> {
  const invocation = buildHeadlessInvocation(options.provider, prompt, options.model)
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
    return { status: 'ok', stdout: result.stdout }
  } catch {
    return { status: 'failed' }
  }
}

export async function generateTabTitle(options: NamingOptions): Promise<TitleResult> {
  const run = await runNamingModel(options, buildTitlePrompt(options.firstPrompt))
  if (run.status !== 'ok') return run
  const title = sanitizeGeneratedTitle(run.stdout)
  return title == null ? { status: 'failed' } : { status: 'ok', title }
}

/** One model call for both names — a workspace must not wait on two. */
export async function generateWorkspaceNaming(options: NamingOptions): Promise<NamingResult> {
  const run = await runNamingModel(options, buildWorkspaceNamingPrompt(options.firstPrompt))
  if (run.status !== 'ok') return run
  const [titleLine, branchLine] = nonEmptyLines(run.stdout)
  const title = titleLine == null ? null : sanitizeGeneratedTitle(titleLine)
  if (title == null) return { status: 'failed' }
  return {
    branch: branchLine == null ? null : sanitizeGeneratedBranch(branchLine),
    status: 'ok',
    title,
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

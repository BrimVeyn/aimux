/**
 * Entry points for the two completion-facing commands:
 *
 *   aimux completion <bash|zsh|fish>   print the script
 *   aimux completion install [--shell] write it to the conventional location
 *   aimux __complete --cword N -- …    resolve one TAB press (hidden)
 *
 * `__complete` runs on every TAB, so this module's static import graph must
 * stay tiny — no daemon client, no UI. See `test/unit/cli-completion-graph`.
 */

import { readPluginCliSidecar } from '../../plugins/cli-commands'
import { EXIT_OK, EXIT_USAGE, writeError } from '../output'
import { detectShell, installCompletionScript, shellConfigHint } from './install'
import { type CompletionPlan, planCompletion } from './plan'
import {
  DIRECTIVE_FILES,
  DIRECTIVE_LIST,
  DIRECTIVE_NONE,
  isSupportedShell,
  renderCompletionScript,
  SUPPORTED_SHELLS,
  type SupportedShell,
} from './scripts'

interface CompleteRequest {
  cword: number
  descriptions: boolean
  words: string[]
}

/**
 * Hand-rolled parser rather than `parseArgs`: `__complete` must never fail
 * with a usage error — a malformed request yields an empty completion, not a
 * message printed into the user's prompt.
 */
function parseCompleteRequest(argv: readonly string[]): CompleteRequest {
  const request: CompleteRequest = { cword: 0, descriptions: true, words: [] }
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === '--cword') {
      const value = Number(argv[++i])
      request.cword = Number.isFinite(value) ? value : 0
      continue
    }
    if (token === '--no-descriptions') {
      request.descriptions = false
      continue
    }
    if (token === '--') {
      request.words = argv.slice(i + 1) as string[]
      break
    }
  }
  return request
}

function renderCandidates(
  candidates: readonly { description?: string; value: string }[],
  descriptions: boolean
): string {
  return candidates
    .map((candidate) => {
      const description = candidate.description ?? ''
      if (!descriptions || description === '') return candidate.value
      // One tab, no newlines: every shell splits the reply on those.
      return `${candidate.value}\t${description.replaceAll(/\s+/g, ' ')}`
    })
    .join('\n')
}

async function resolvePlan(plan: CompletionPlan, descriptions: boolean): Promise<string> {
  switch (plan.kind) {
    case 'candidates': {
      if (plan.candidates.length === 0) return DIRECTIVE_NONE
      return `${renderCandidates(plan.candidates, descriptions)}\n${DIRECTIVE_LIST}`
    }
    case 'dynamic': {
      const { resolveDynamicCandidates } = await import('./sources')
      const candidates = await resolveDynamicCandidates(
        plan.source,
        plan.word,
        plan.prefix,
        plan.positionals
      )
      if (candidates.length === 0) return DIRECTIVE_NONE
      return `${renderCandidates(candidates, descriptions)}\n${DIRECTIVE_LIST}`
    }
    case 'files':
      return DIRECTIVE_FILES
    case 'none':
      return DIRECTIVE_NONE
  }
}

/** Resolve one TAB press. Always exits 0 — a shell is listening, not a human. */
export async function runComplete(argv: readonly string[]): Promise<number> {
  try {
    const request = parseCompleteRequest(argv)
    // One small JSON read, not a socket: `__complete` runs on every TAB press
    // and must not wait on the daemon, but it should still offer a plugin's
    // verbs. The daemon rewrites the sidecar whenever the registry changes.
    const plan = planCompletion(request.words, request.cword, readPluginCliSidecar())
    process.stdout.write(`${await resolvePlan(plan, request.descriptions)}\n`)
  } catch {
    process.stdout.write(`${DIRECTIVE_NONE}\n`)
  }
  return EXIT_OK
}

function printCompletionHelp(): void {
  process.stdout.write(
    [
      'aimux completion — shell tab completion',
      '',
      'Usage:',
      '  aimux completion <bash|zsh|fish>     Print the completion script',
      '  aimux completion install             Install it for the detected shell',
      '',
      'Flags:',
      '  --shell <bash|zsh|fish>        Override shell detection (install)',
      '  --command <invocation>         How the script should call aimux',
      '                                 (dev: "bun run /path/to/src/index.tsx")',
      '',
      'aimux installs completion for your shell automatically on first launch.',
      'Set AIMUX_NO_COMPLETION_INSTALL=1 to opt out.',
      '',
    ].join('\n')
  )
}

function flagValue(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`)
  if (index !== -1) return argv[index + 1]
  const inline = argv.find((token) => token.startsWith(`--${name}=`))
  return inline?.slice(name.length + 3)
}

/** `aimux completion …` — print or install a script. */
export function runCompletion(argv: readonly string[]): number {
  const subcommand = argv[0] ?? ''
  const command = flagValue(argv, 'command')

  if (subcommand === '' || subcommand === '--help' || subcommand === '-h') {
    printCompletionHelp()
    return subcommand === '' ? EXIT_USAGE : EXIT_OK
  }

  if (isSupportedShell(subcommand)) {
    process.stdout.write(renderCompletionScript(subcommand, command))
    return EXIT_OK
  }

  if (subcommand !== 'install') {
    writeError(`unknown completion target: ${subcommand}`)
    printCompletionHelp()
    return EXIT_USAGE
  }

  const requested = flagValue(argv, 'shell')
  let shell: SupportedShell | null
  if (requested === undefined) {
    shell = detectShell()
  } else if (isSupportedShell(requested)) {
    shell = requested
  } else {
    writeError(`unsupported shell: ${requested} (supported: ${SUPPORTED_SHELLS.join(', ')})`)
    return EXIT_USAGE
  }

  if (shell === null) {
    writeError(
      `could not detect your shell from $SHELL — pass --shell <${SUPPORTED_SHELLS.join('|')}>`
    )
    return EXIT_USAGE
  }

  try {
    const result = installCompletionScript(shell, command)
    process.stdout.write(`installed ${result.shell} completion → ${result.path}\n`)
    const hint = shellConfigHint(result)
    if (hint !== '') process.stdout.write(`${hint}\n`)
    process.stdout.write('restart your shell (or start a new one) to pick it up\n')
    return EXIT_OK
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeError(`completion install failed: ${message}`)
    return EXIT_USAGE
  }
}

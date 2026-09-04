/**
 * Minimal flag/positional parser. ~50 lines as the plan calls for — no
 * external dep. Supports `--flag value`, `--flag=value`, boolean `--flag`,
 * and `--` to end flag parsing. Unknown flags produce a usage error.
 */

/**
 * A dynamic completion source — resolved at TAB time from live state (catalog
 * file, config, or the daemon) rather than from a fixed list. Resolution is
 * always best-effort: a source that can't be reached yields no candidates
 * instead of blocking or erroring the shell.
 */
export type DynamicCompletionSource =
  | 'assistant'
  | 'git-ref'
  | 'tab'
  | 'worker'
  | 'project'
  | 'workspace'
  | 'plugin'
  /** Resolved from the plugin id in the positional before this one. */
  | 'plugin-config-key'
  | 'plugin-keymap-id'

/**
 * Where a flag value or positional draws its shell-completion candidates.
 * Declared on the spec next to `description` so `--help` and completion are
 * generated from one source and can never drift apart.
 *
 * - `values` — fixed vocabulary, zero I/O
 * - `dynamic` — resolved from live state, best-effort
 * - `file`  — hand off to the shell's own filename completion
 * - `none`  — free text (prompts, models, branch names we can't enumerate)
 */
export type CompletionSource =
  | { kind: 'dynamic'; source: DynamicCompletionSource }
  | { kind: 'file' }
  | { kind: 'none' }
  | { kind: 'values'; values: readonly string[] }

export interface FlagSpec {
  name: string
  kind: 'string' | 'number' | 'boolean' | 'optional-string'
  description?: string
  /** Completion source for this flag's VALUE. Boolean flags take none. */
  complete?: CompletionSource
}

export interface ArgSpec {
  name: string
  required?: boolean
  complete?: CompletionSource
}

export interface ParsedArgs {
  flags: Record<string, string | number | boolean>
  positionals: string[]
}

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CliUsageError'
  }
}

export function parseArgs(
  argv: string[],
  flagSpecs: readonly FlagSpec[],
  argSpecs: readonly ArgSpec[]
): ParsedArgs {
  const flagByName = new Map<string, FlagSpec>()
  for (const spec of flagSpecs) flagByName.set(spec.name, spec)
  // Deprecated aliases from the project/workspace rename. Unlike the command
  // groups these are safe to map silently: --workspace named a project and
  // --worktree named what is now a workspace, so each old name still points at
  // the same object.
  // ponytail: drop with the aimux-sessions.json fallback.
  // Resolved against the declared specs, never against another alias —
  // otherwise --worktree would chain through the --workspace alias onto
  // --project, which is a different object entirely.
  for (const [old, current] of [
    ['workspace', 'project'],
    ['worktree', 'workspace'],
    ['new-worktree', 'new-workspace'],
  ] as const) {
    if (flagByName.has(old)) continue
    const spec = flagSpecs.find((entry) => entry.name === current)
    if (spec) flagByName.set(old, spec)
  }

  const flags: Record<string, string | number | boolean> = {}
  const positionals: string[] = []
  let stopFlags = false

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? ''
    if (token === '--') {
      stopFlags = true
      continue
    }
    if (!stopFlags && token.startsWith('--')) {
      const eq = token.indexOf('=')
      const name = eq === -1 ? token.slice(2) : token.slice(2, eq)
      const spec = flagByName.get(name)
      if (!spec) {
        throw new CliUsageError(`unknown flag: --${name}`)
      }
      // Deprecated aliases resolve to the current spec, so results are always
      // keyed by the canonical name regardless of which spelling was typed.
      const key = spec.name
      if (spec.kind === 'boolean') {
        if (eq !== -1) {
          throw new CliUsageError(`flag --${name} does not take a value`)
        }
        flags[key] = true
        continue
      }
      if (spec.kind === 'optional-string') {
        // Value binds ONLY in the `=` form (`--flag=value`). A bare `--flag`
        // must not swallow the next token (it may be a positional), so it
        // parses as boolean `true`.
        flags[key] = eq === -1 ? true : token.slice(eq + 1)
        continue
      }
      const raw = eq === -1 ? argv[++i] : token.slice(eq + 1)
      if (raw === undefined) {
        throw new CliUsageError(`flag --${name} requires a value`)
      }
      if (spec.kind === 'number') {
        const parsed = Number(raw)
        if (!Number.isFinite(parsed)) {
          throw new CliUsageError(`flag --${name} must be a number (got: ${raw})`)
        }
        flags[key] = parsed
      } else {
        flags[key] = raw
      }
      continue
    }
    positionals.push(token)
  }

  for (let i = 0; i < argSpecs.length; i++) {
    const spec = argSpecs[i]
    if (!spec) continue
    if (spec.required === true && positionals[i] === undefined) {
      throw new CliUsageError(`missing required argument: <${spec.name}>`)
    }
  }

  return { flags, positionals }
}

/**
 * Shared flag set — every command takes these. `--project` selects the
 * target project (by id or name); `--profile` overrides `AIMUX_PROFILE`
 * before any runtime path is resolved; `--json` is a no-op kept for
 * consistency with future formats.
 */
export const SHARED_FLAGS: readonly FlagSpec[] = [
  {
    complete: { kind: 'dynamic', source: 'project' },
    description: 'project id or name',
    kind: 'string',
    name: 'project',
  },
  {
    complete: { kind: 'none' },
    description: 'runtime profile override (sets AIMUX_PROFILE)',
    kind: 'string',
    name: 'profile',
  },
  { description: 'always-on JSON output (kept for consistency)', kind: 'boolean', name: 'json' },
]

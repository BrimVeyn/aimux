/**
 * Pure completion planner. Given the shell's current words + cursor index it
 * decides WHAT should be completed — never how, and never with I/O. Dynamic
 * sources come back as a plan the caller resolves (see `sources.ts`), which
 * keeps this whole file unit-testable and free of daemon/filesystem access.
 *
 * The candidate lists are derived from `COMMANDS`, the same registry that
 * generates `--help`, so completion cannot drift from the documented CLI.
 */

import type { PluginCliCommandSpec } from '../../plugins/cli-commands'
import type { CompletionSource, DynamicCompletionSource, FlagSpec } from '../flags'

import { type CliCommand, COMMANDS, resolveCommand } from '../registry'

export interface CompletionCandidate {
  description?: string
  value: string
}

export type CompletionPlan =
  /** Ready-to-print candidates, already filtered and prefixed. */
  | { candidates: CompletionCandidate[]; kind: 'candidates' }
  /** Needs live state. `prefix` is re-applied to each resolved value. */
  | { kind: 'dynamic'; prefix: string; source: DynamicCompletionSource; word: string }
  /** Hand off to the shell's own filename completion. */
  | { kind: 'files' }
  /** Free text — offer nothing. */
  | { kind: 'none' }

const NONE: CompletionPlan = { kind: 'none' }

/**
 * Top-level (non-group) commands, mirroring the branches in `src/index.tsx`.
 * `daemon` / `terminal-manager` / `__complete` are internal and stay hidden.
 */
export const TOP_LEVEL_COMMANDS: readonly CompletionCandidate[] = [
  { description: 'Print setup diagnostics', value: 'doctor' },
  { description: 'Self-update to the latest release', value: 'update' },
  { description: 'Print the package version', value: 'version' },
  { description: 'Restart the IPC daemon (PTYs survive)', value: 'restart-daemon' },
  { description: 'Restart the terminal manager (kills PTYs)', value: 'restart-terminal-manager' },
  { description: 'Print or install a shell completion script', value: 'completion' },
  { description: 'Show CLI help', value: 'help' },
]

const COMPLETION_SUBCOMMANDS: readonly CompletionCandidate[] = [
  { description: 'Print the bash completion script', value: 'bash' },
  { description: 'Print the fish completion script', value: 'fish' },
  { description: 'Print the zsh completion script', value: 'zsh' },
  { description: 'Install the script for the detected shell', value: 'install' },
]

const GROUP_DESCRIPTIONS: Record<string, string> = {
  project: 'Projects (projects) in the profile catalog',
  tab: 'Drive individual tabs (create, send, snapshot, await)',
  worker: 'Named agent workers — the preferred orchestration surface',
  workspace: 'Git workspaces attached to the active project',
}

/** A sidecar spec, shaped like a `CliCommand` for the planner's purposes. */
function asCommands(specs: readonly PluginCliCommandSpec[]): CliCommand[] {
  return specs.map((spec) => ({
    args: spec.args ?? [],
    flags: spec.flags ?? [],
    group: spec.group,
    run: async () => 0,
    summary: spec.summary,
    verb: spec.verb,
  }))
}

function groupCandidates(pluginCommands: readonly PluginCliCommandSpec[]): CompletionCandidate[] {
  const seen = new Set<string>()
  const candidates: CompletionCandidate[] = []
  for (const command of [...COMMANDS, ...asCommands(pluginCommands)]) {
    if (seen.has(command.group)) continue
    seen.add(command.group)
    candidates.push({ description: GROUP_DESCRIPTIONS[command.group], value: command.group })
  }
  return candidates
}

function filtered(candidates: readonly CompletionCandidate[], word: string): CompletionPlan {
  const matches = candidates
    .filter((candidate) => candidate.value.startsWith(word))
    .map((candidate) => ({ ...candidate }))
  return { candidates: matches, kind: 'candidates' }
}

function fromSource(
  source: CompletionSource | undefined,
  word: string,
  prefix: string
): CompletionPlan {
  if (!source) return NONE
  switch (source.kind) {
    case 'dynamic':
      return { kind: 'dynamic', prefix, source: source.source, word }
    case 'file':
      return { kind: 'files' }
    case 'values': {
      const matches = source.values
        .filter((value) => value.startsWith(word))
        .map((value) => ({ value: `${prefix}${value}` }))
      return { candidates: matches, kind: 'candidates' }
    }
    // 'none' and any future kind fall through to no candidates.
    default:
      return NONE
  }
}

interface TokenScan {
  /** Set when the last token was a flag still waiting for its value. */
  awaitingValueFor: FlagSpec | null
  positionalCount: number
  stoppedFlags: boolean
  usedFlags: Set<string>
}

/**
 * Walk the tokens BEFORE the cursor the way `parseArgs` would, but tolerant of
 * anything malformed — a half-typed command line is the normal case here.
 */
function scanTokens(tokens: readonly string[], flags: readonly FlagSpec[]): TokenScan {
  const byName = new Map(flags.map((flag) => [flag.name, flag]))
  const scan: TokenScan = {
    awaitingValueFor: null,
    positionalCount: 0,
    stoppedFlags: false,
    usedFlags: new Set<string>(),
  }

  for (const token of tokens) {
    if (scan.awaitingValueFor) {
      scan.awaitingValueFor = null
      continue
    }
    if (!scan.stoppedFlags && token === '--') {
      scan.stoppedFlags = true
      continue
    }
    if (!scan.stoppedFlags && token.startsWith('--')) {
      const eq = token.indexOf('=')
      const name = eq === -1 ? token.slice(2) : token.slice(2, eq)
      scan.usedFlags.add(name)
      const spec = byName.get(name)
      // `optional-string` only ever binds via `=`, so a bare one never awaits.
      if (spec && eq === -1 && (spec.kind === 'string' || spec.kind === 'number')) {
        scan.awaitingValueFor = spec
      }
      continue
    }
    scan.positionalCount++
  }

  return scan
}

function planTopLevel(
  word: string,
  pluginCommands: readonly PluginCliCommandSpec[]
): CompletionPlan {
  if (word.startsWith('-')) {
    return filtered(
      [
        { description: 'Show CLI help', value: '--help' },
        { description: 'Print the package version', value: '--version' },
      ],
      word
    )
  }
  return filtered([...groupCandidates(pluginCommands), ...TOP_LEVEL_COMMANDS], word)
}

/**
 * @param words Full command line tokens, including the program name at index 0.
 * @param cword Index into `words` of the token being completed.
 */
export function planCompletion(
  words: readonly string[],
  cword: number,
  /**
   * Plugin verbs, read from the daemon's sidecar by the caller. Passed in
   * rather than read here so this module keeps its no-I/O property, which is
   * what makes every branch of it unit-testable.
   */
  pluginCommands: readonly PluginCliCommandSpec[] = []
): CompletionPlan {
  const index = Math.max(0, cword)
  const word = words[index] ?? ''
  const argIndex = index - 1
  if (argIndex < 0) return NONE

  const args = words.slice(1)
  if (argIndex === 0) return planTopLevel(word, pluginCommands)

  const group = args[0] ?? ''

  if (group === 'completion') {
    return argIndex === 1 ? filtered(COMPLETION_SUBCOMMANDS, word) : NONE
  }

  const verbs = [...COMMANDS, ...asCommands(pluginCommands)].filter(
    (command) => command.group === group
  )
  if (verbs.length === 0) return NONE

  if (argIndex === 1) {
    return filtered(
      verbs.map((command) => ({ description: command.summary, value: command.verb })),
      word
    )
  }

  const command = resolveCommand(group, args[1] ?? '')
  if (!command) return NONE

  const scan = scanTokens(args.slice(2, argIndex), command.flags)

  if (scan.awaitingValueFor) {
    return fromSource(scan.awaitingValueFor.complete, word, '')
  }

  if (!scan.stoppedFlags && word.startsWith('--')) {
    const eq = word.indexOf('=')
    if (eq !== -1) {
      const name = word.slice(2, eq)
      const spec = command.flags.find((flag) => flag.name === name)
      if (!spec || spec.kind === 'boolean') return NONE
      return fromSource(spec.complete, word.slice(eq + 1), `--${name}=`)
    }
    return filtered(
      command.flags
        .filter((flag) => !scan.usedFlags.has(flag.name))
        .map((flag) => ({ description: flag.description, value: `--${flag.name}` })),
      word
    )
  }

  return fromSource(command.args[scan.positionalCount]?.complete, word, '')
}

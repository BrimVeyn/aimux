import { homedir } from 'node:os'
import { basename, join } from 'node:path'

import type { AssistantId } from '../state/types'

/**
 * How an assistant renders a vendor-neutral model / reasoning-effort selection
 * into its own CLI args. Vendor flag syntax lives here on the assistant
 * definition — the source of truth — rather than in a separate resolver, so
 * there's exactly one place that knows `claude` takes `--effort` while `codex`
 * takes `-c model_reasoning_effort=…`. An absent builder means the CLI has no
 * control for that dimension, and passing `--model` / `--effort` for it is an
 * error (see `buildAssistantModelArgs`). Values themselves are passed through
 * unvalidated: the worker CLI is the source of truth for its own vocabulary and
 * rejects a bad value with its own clear startup error.
 */
export interface AssistantModelSpec {
  buildModelArgs?: (model: string) => string[]
  buildEffortArgs?: (effort: string) => string[]
}

/**
 * How an assistant names a resumable conversation on the command line. Same
 * philosophy as `AssistantModelSpec`: the vendor's flag syntax lives on the
 * assistant definition, not in a resolver.
 *
 * Two builders because the two directions are different flags, not one flag
 * with two meanings — `claude --session-id <uuid>` *claims* an id for a new
 * conversation and errors with "Session ID … is already in use" if it exists,
 * while `claude --resume <uuid>` refuses an id that does not. An assistant that
 * can resume but cannot be told its id up front (codex: `codex resume <id>`,
 * with no way to fix the id at spawn) has no entry here — its id would have to
 * be discovered after the fact, which is a different mechanism.
 */
export interface AssistantSessionSpec {
  /** Args that pin a fresh conversation to `sessionId`. */
  buildSessionArgs: (sessionId: string) => string[]
  /** Args that reopen the conversation `sessionId` names. */
  buildResumeArgs: (sessionId: string) => string[]
  /**
   * Whether the vendor has a stored conversation under this id. Asking the
   * filesystem is what lets one spawn path serve both directions: an id with a
   * transcript resumes, an id without one is claimed fresh. Without it, a tab
   * you opened and never typed into would resume into "No conversation found"
   * and exit — and an exiting PTY takes the tab with it.
   */
  hasConversation: (sessionId: string) => boolean
}

export interface AssistantOption {
  id: AssistantId
  label: string
  command: string
  description: string
  model?: AssistantModelSpec
  session?: AssistantSessionSpec
  /**
   * The CLI starts an interactive session with a positional prompt argument
   * (`claude "…"`, `codex "…"`). When it does, handing the prompt over at spawn
   * beats pasting it into the running TUI afterwards: no readiness poll, no
   * screen probe, no retries.
   *
   * Absent means "unknown or not supported" and the caller falls back to
   * `injectPromptWhenReady`. `opencode`'s positional is a project path and its
   * `run` subcommand is non-interactive, so it stays on the fallback.
   *
   * ponytail: a boolean, because both CLIs that support it are positional.
   * Promote to a builder — as `AssistantModelSpec` already does for flags — when
   * a `--prompt <x>`-shaped one shows up.
   */
  acceptsPromptArg?: boolean
}

function claudeProjectsDir(): string {
  return join(homedir(), '.claude', 'projects')
}

const DEFAULT_SHELL =
  process.env.SHELL != null && process.env.SHELL !== '' ? process.env.SHELL : 'sh'
const SHELL_NAME = DEFAULT_SHELL.split('/').pop() ?? 'shell'

export const ASSISTANT_OPTIONS: AssistantOption[] = [
  {
    acceptsPromptArg: true,
    command: 'claude',
    description: 'Anthropic Claude CLI',
    id: 'claude',
    label: 'Claude',
    model: {
      buildEffortArgs: (effort) => ['--effort', effort],
      buildModelArgs: (model) => ['--model', model],
    },
    session: {
      buildResumeArgs: (sessionId) => ['--resume', sessionId],
      buildSessionArgs: (sessionId) => ['--session-id', sessionId],
      // `~/.claude/projects/<cwd-slug>/<uuid>.jsonl`. Globbing the slug away
      // beats deriving it: the uuid alone is unique, so we never have to model
      // how the vendor mangles a path into a directory name.
      hasConversation: (sessionId) =>
        new Bun.Glob(`*/${sessionId}.jsonl`).scanSync({ cwd: claudeProjectsDir() }).next().done !==
        true,
    },
  },
  {
    acceptsPromptArg: true,
    command: 'codex',
    description: 'OpenAI Codex CLI',
    id: 'codex',
    label: 'Codex',
    model: {
      buildEffortArgs: (effort) => ['-c', `model_reasoning_effort=${effort}`],
      buildModelArgs: (model) => ['--model', model],
    },
  },
  {
    command: 'opencode',
    description: 'OpenCode CLI',
    id: 'opencode',
    label: 'OpenCode',
    // OpenCode takes a `provider/model` selector but has no reasoning-effort flag.
    model: {
      buildModelArgs: (model) => ['--model', model],
    },
  },
  {
    command: 'grok',
    description: 'xAI Grok Build CLI',
    id: 'grok',
    label: 'Grok',
    model: {
      // Grok supports -m (and likely --model) plus --effort (alias --reasoning-effort).
      buildEffortArgs: (effort) => ['--effort', effort],
      buildModelArgs: (model) => ['-m', model],
    },
  },
  {
    command: 'kimi',
    description: 'Moonshot Kimi Code CLI',
    id: 'kimi',
    label: 'Kimi',
    // Kimi supports --model / -m; no reasoning-effort flag.
    model: {
      buildModelArgs: (model) => ['--model', model],
    },
  },
  {
    command: 'agy',
    description: 'Antigravity CLI',
    id: 'antigravity',
    label: 'Antigravity',
  },
  {
    command: DEFAULT_SHELL,
    description: `Plain terminal (${SHELL_NAME})`,
    id: 'terminal',
    label: 'Terminal',
  },
]

export function getAssistantOption(index: number): AssistantOption {
  const option = ASSISTANT_OPTIONS[index] ?? ASSISTANT_OPTIONS[0]
  if (!option) {
    throw new Error('Assistant options are not configured.')
  }

  return option
}

export function getAllAssistantOptions(customCommands: Record<string, string>): AssistantOption[] {
  const builtinIds = new Set(ASSISTANT_OPTIONS.map((o) => o.id))
  const customOptions: AssistantOption[] = Object.entries(customCommands)
    .filter(([id]) => !builtinIds.has(id))
    .map(([id, command]) => ({
      command,
      description: `Custom (${command})`,
      id,
      label: id.charAt(0).toUpperCase() + id.slice(1),
    }))
  return [...ASSISTANT_OPTIONS, ...customOptions]
}

/**
 * Whether this assistant can take the initial prompt as a spawn argument.
 *
 * A custom command counts only while it still runs the same program — extra
 * flags are fine, a wrapper is not. A wrapper that forgets `"$@"` would swallow
 * the prompt with no error anywhere, and pasting works for any command, so the
 * unrecognised executable falls back rather than gambling.
 */
export function assistantAcceptsPromptArg(
  assistant: AssistantId,
  customCommands: Record<string, string>
): boolean {
  const option = getAllAssistantOptions(customCommands).find((entry) => entry.id === assistant)
  if (option?.acceptsPromptArg !== true) return false
  return runsVendorProgram(option, customCommands)
}

/**
 * Whether the configured command still runs the program the assistant's flags
 * were written for. Extra flags are fine; a wrapper script is not, because any
 * flag we append lands on the wrapper rather than the vendor CLI.
 */
function runsVendorProgram(
  option: AssistantOption,
  customCommands: Record<string, string>
): boolean {
  const custom = customCommands[option.id]
  if (custom == null || custom === '') return true
  return basename(parseCommand(custom).executable) === option.command
}

/**
 * The args that tie a spawn to `sessionId` — resume when the vendor already has
 * a conversation under that id, claim it otherwise.
 *
 * One function for both directions on purpose: every spawn site (new tab,
 * split, Ctrl+r, waking a hibernated tab) wants the same thing — "be this
 * conversation" — and the filesystem, not the call site, is what knows whether
 * that conversation exists yet. A caller that had to pick would get it wrong
 * exactly once: on the tab that was opened and never typed into.
 *
 * Empty for an assistant with no session support, and for a custom command
 * that already bakes in its own session flags — doubling `--resume` is an error
 * the vendor would report at spawn, long after the useful stack is gone.
 */
export function buildAssistantSessionArgs(
  assistant: AssistantId,
  customCommands: Record<string, string>,
  sessionId: string
): string[] {
  if (sessionId === '') return []
  const option = getAllAssistantOptions(customCommands).find((entry) => entry.id === assistant)
  if (!option?.session) return []
  if (!runsVendorProgram(option, customCommands)) return []
  const custom = customCommands[assistant] ?? ''
  if (/(^|\s)(-r|--resume|--session-id|--continue|-c)(\s|$)/.test(custom)) return []
  return option.session.hasConversation(sessionId)
    ? option.session.buildResumeArgs(sessionId)
    : option.session.buildSessionArgs(sessionId)
}

export function isCommandAvailable(command: string): boolean {
  return Bun.which(command) !== null
}

/**
 * Minimal POSIX shell-word splitter — respects single/double quotes and
 * backslash escapes so values like `code --user-data-dir "/tmp/foo bar"` or a
 * script path under a `$HOME` containing a space tokenize correctly.
 * Does not expand variables or globs.
 */
export function shellSplit(input: string): string[] {
  const out: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false
  let hasToken = false
  for (let i = 0; i < input.length; i++) {
    const c = input[i] ?? ''
    if (!inSingle && !inDouble && /\s/.test(c)) {
      if (hasToken) {
        out.push(current)
        current = ''
        hasToken = false
      }
      continue
    }
    hasToken = true
    if (c === "'" && !inDouble) {
      inSingle = !inSingle
    } else if (c === '"' && !inSingle) {
      inDouble = !inDouble
    } else if (c === '\\' && !inSingle && i + 1 < input.length) {
      current += input[++i]
    } else {
      current += c
    }
  }
  if (hasToken) out.push(current)
  return out
}

/** Wrap a value so `shellSplit` (and a real shell) return it as one word. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

export function parseCommand(commandString: string): { executable: string; args: string[] } {
  const parts = shellSplit(commandString.trim())
  return { args: parts.slice(1), executable: parts[0] ?? '' }
}

/**
 * Translate a vendor-neutral `{ model, effort }` selection into the extra CLI
 * args to append to an assistant's default command. Throws if the assistant has
 * no control for a requested dimension (e.g. `--effort` on OpenCode, anything on
 * `terminal`) — that combination is unrepresentable, so we fail at the CLI
 * boundary rather than spawn a worker that silently ignores the request.
 */
export function buildAssistantModelArgs(
  option: AssistantOption,
  selection: { model?: string; effort?: string }
): string[] {
  const args: string[] = []
  const { effort, model } = selection

  if (model !== undefined && model !== '') {
    if (!option.model?.buildModelArgs) {
      throw new Error(`assistant '${option.id}' does not support --model`)
    }
    args.push(...option.model.buildModelArgs(model))
  }

  if (effort !== undefined && effort !== '') {
    if (!option.model?.buildEffortArgs) {
      throw new Error(`assistant '${option.id}' does not support --effort`)
    }
    args.push(...option.model.buildEffortArgs(effort))
  }

  return args
}

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

export interface AssistantOption {
  id: AssistantId
  label: string
  command: string
  description: string
  model?: AssistantModelSpec
}

const DEFAULT_SHELL =
  process.env.SHELL != null && process.env.SHELL !== '' ? process.env.SHELL : 'sh'
const SHELL_NAME = DEFAULT_SHELL.split('/').pop() ?? 'shell'

export const ASSISTANT_OPTIONS: AssistantOption[] = [
  {
    command: 'claude',
    description: 'Anthropic Claude CLI',
    id: 'claude',
    label: 'Claude',
    model: {
      buildEffortArgs: (effort) => ['--effort', effort],
      buildModelArgs: (model) => ['--model', model],
    },
  },
  {
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

import type { AssistantId } from '../state/types'

export interface AssistantOption {
  id: AssistantId
  label: string
  command: string
  description: string
}

const DEFAULT_SHELL = process.env.SHELL || 'sh'
const SHELL_NAME = DEFAULT_SHELL.split('/').pop() ?? 'shell'

export const ASSISTANT_OPTIONS: AssistantOption[] = [
  {
    id: 'claude',
    label: 'Claude',
    command: 'claude',
    description: 'Anthropic Claude CLI',
  },
  {
    id: 'codex',
    label: 'Codex',
    command: 'codex',
    description: 'OpenAI Codex CLI',
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    command: 'opencode',
    description: 'OpenCode CLI',
  },
  {
    id: 'terminal',
    label: 'Terminal',
    command: DEFAULT_SHELL,
    description: `Plain terminal (${SHELL_NAME})`,
  },
]

export function getAssistantOption(index: number): AssistantOption {
  return ASSISTANT_OPTIONS[index] ?? ASSISTANT_OPTIONS[0]!
}

export function getAllAssistantOptions(customCommands: Record<string, string>): AssistantOption[] {
  const builtinIds = new Set(ASSISTANT_OPTIONS.map((o) => o.id))
  const customOptions: AssistantOption[] = Object.entries(customCommands)
    .filter(([id]) => !builtinIds.has(id))
    .map(([id, command]) => ({
      id,
      label: id.charAt(0).toUpperCase() + id.slice(1),
      command,
      description: `Custom (${command})`,
    }))
  return [...ASSISTANT_OPTIONS, ...customOptions]
}

export function isCommandAvailable(command: string): boolean {
  return Bun.which(command) !== null
}

export function parseCommand(commandString: string): { executable: string; args: string[] } {
  const parts = commandString.trim().split(/\s+/).filter(Boolean)
  return { executable: parts[0] ?? '', args: parts.slice(1) }
}

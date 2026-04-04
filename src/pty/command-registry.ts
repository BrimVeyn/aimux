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
    command: 'claude',
    description: 'Anthropic Claude CLI',
    id: 'claude',
    label: 'Claude',
  },
  {
    command: 'codex',
    description: 'OpenAI Codex CLI',
    id: 'codex',
    label: 'Codex',
  },
  {
    command: 'opencode',
    description: 'OpenCode CLI',
    id: 'opencode',
    label: 'OpenCode',
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

export function parseCommand(commandString: string): { executable: string; args: string[] } {
  const parts = commandString.trim().split(/\s+/).filter(Boolean)
  return { args: parts.slice(1), executable: parts[0] ?? '' }
}

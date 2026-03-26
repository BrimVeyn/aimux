import type { AssistantId } from "../state/types";

export interface AssistantOption {
  id: AssistantId;
  label: string;
  command: string;
  description: string;
}

export const ASSISTANT_OPTIONS: AssistantOption[] = [
  {
    id: "claude",
    label: "Claude",
    command: "claude",
    description: "Anthropic Claude CLI",
  },
  {
    id: "codex",
    label: "Codex",
    command: "codex",
    description: "OpenAI Codex CLI",
  },
  {
    id: "opencode",
    label: "OpenCode",
    command: "opencode",
    description: "OpenCode CLI",
  },
];

export function getAssistantOption(index: number): AssistantOption {
  return ASSISTANT_OPTIONS[index] ?? ASSISTANT_OPTIONS[0]!;
}

export function isCommandAvailable(command: string): boolean {
  return Bun.which(command) !== null;
}

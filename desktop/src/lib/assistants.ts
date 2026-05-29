// Mirror of aimux's builtin ASSISTANT_OPTIONS (src/pty/command-registry.ts) +
// filterAssistants (src/state/selectors.ts), for rendering the new-tab modal.
// Selection/launch is handled host-side; this is display only.

export interface AssistantOption {
  id: string;
  label: string;
  command: string;
  description: string;
}

const BUILTIN: AssistantOption[] = [
  { command: "claude", description: "Anthropic Claude CLI", id: "claude", label: "Claude" },
  { command: "codex", description: "OpenAI Codex CLI", id: "codex", label: "Codex" },
  { command: "opencode", description: "OpenCode CLI", id: "opencode", label: "OpenCode" },
  { command: "agy", description: "Antigravity CLI", id: "antigravity", label: "Antigravity" },
  { command: "$SHELL", description: "Plain terminal", id: "terminal", label: "Terminal" },
];

export function allAssistants(customCommands: Record<string, string>): AssistantOption[] {
  const builtinIds = new Set(BUILTIN.map((o) => o.id));
  const custom: AssistantOption[] = Object.entries(customCommands)
    .filter(([id]) => !builtinIds.has(id))
    .map(([id, command]) => ({
      command,
      description: `Custom (${command})`,
      id,
      label: id.charAt(0).toUpperCase() + id.slice(1),
    }));
  return [...BUILTIN, ...custom];
}

export function filterAssistants(
  options: AssistantOption[],
  filter: string | null,
): AssistantOption[] {
  if (filter === null || filter === "") {
    return options;
  }
  const lower = filter.toLowerCase();
  return options.filter(
    (o) => o.label.toLowerCase().includes(lower) || o.description.toLowerCase().includes(lower),
  );
}

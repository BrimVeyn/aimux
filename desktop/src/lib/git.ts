// Format git divergence as `↑N ↓M`, skipping any zero side. Mirrors the TUI
// helper in src/ui/components/modals/workspace/workspace-move-modal.tsx.
export function formatDivergence(
  divergence: { ahead: number; behind: number } | undefined,
): string {
  if (divergence == null) return "";
  const parts: string[] = [];
  if (divergence.ahead > 0) parts.push(`↑${divergence.ahead}`);
  if (divergence.behind > 0) parts.push(`↓${divergence.behind}`);
  return parts.join(" ");
}

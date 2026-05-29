import { Row } from "@/components/ModalHost";
import { AimuxButton } from "@/components/ui/AimuxButton";
import { formatDivergence } from "@/lib/git";
import { theme } from "@/lib/theme";
import type { ModalProjection, SessionRecordLite } from "@/lib/types";

const MOVE_HINTS: [key: string, label: string][] = [
  ["↵", "move into selected target"],
  ["click", "toggle delete"],
  ["↑/↓ or j/k", "change target"],
  ["esc", "cancel"],
];

interface WorktreeMoveModalProps {
  modal: ModalProjection;
  sessions: SessionRecordLite[];
  currentSessionId: string | null;
  worktreeDivergence: Record<string, { ahead: number; behind: number }>;
  onSelect: (index: number) => void;
  onConfirm: (index: number) => void;
  onToggleDeleteSource: () => void;
}

export function WorktreeMoveModal({
  modal,
  sessions,
  currentSessionId,
  worktreeDivergence,
  onSelect,
  onConfirm,
  onToggleDeleteSource,
}: WorktreeMoveModalProps) {
  const session = sessions.find((s) => s.id === currentSessionId);
  const worktrees = session?.worktrees ?? [];
  const sourceId = modal.sourceWorktreeId;
  const source = worktrees.find((w) => w.id === sourceId);
  const sourceLabel =
    source?.branch !== undefined && source.branch !== ""
      ? source.branch
      : (source?.name ?? "worktree");
  const targets = worktrees.filter((w) => w.id !== sourceId);
  const deleteSource = modal.deleteSource ?? false;
  return (
    <div className="flex flex-col gap-2">
      <div className="font-bold">
        Move <span style={{ color: theme.primary }}>{sourceLabel}</span> →
      </div>
      <div className="flex flex-col">
        {targets.length === 0 ? (
          <div className="px-2 py-1" style={{ color: theme.textMuted }}>
            No other worktree to move into.
          </div>
        ) : (
          targets.map((wt, index) => {
            const primary = wt.source === "primary" ? " (primary)" : "";
            const divergence = formatDivergence(worktreeDivergence[wt.id]);
            const primaryText =
              wt.branch !== undefined && wt.branch !== "" ? wt.branch : wt.name;
            const label = `${primaryText}${primary}${divergence !== "" ? ` ${divergence}` : ""}`;
            return (
              <Row
                key={wt.id}
                selected={index === modal.selectedIndex}
                label={label}
                onSelect={() => onSelect(index)}
                onConfirm={() => onConfirm(index)}
              />
            );
          })
        )}
      </div>
      <div className="flex flex-col gap-1 pt-1">
        <AimuxButton
          className="px-2 py-1 text-left"
          onClick={onToggleDeleteSource}
          variant="ghost"
        >
          <span style={{ color: theme.textMuted }}>delete source after move: </span>
          <span style={{ color: deleteSource ? theme.warning : theme.text }}>
            {deleteSource ? "on" : "off"}
          </span>
        </AimuxButton>
        <div className="pt-1" style={{ color: theme.textMuted }}>
          {MOVE_HINTS.map(([key, label]) => (
            <div key={key} className="flex gap-2">
              <span className="w-24 shrink-0" style={{ color: theme.primary }}>
                {key}
              </span>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

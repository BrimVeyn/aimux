import { Row } from "@/components/ModalHost";
import { Button } from "@/components/ui/button";
import { formatDivergence } from "@/lib/git";
import { theme } from "@/lib/theme";
import type { ModalProjection, ProjectRecordLite } from "@/lib/types";

const MOVE_HINTS: [key: string, label: string][] = [
  ["↵", "move into selected target"],
  ["click", "toggle delete"],
  ["↑/↓ or j/k", "change target"],
  ["esc", "cancel"],
];

interface WorkspaceMoveModalProps {
  modal: ModalProjection;
  projects: ProjectRecordLite[];
  currentProjectId: string | null;
  workspaceDivergence: Record<string, { ahead: number; behind: number }>;
  onSelect: (index: number) => void;
  onConfirm: (index: number) => void;
  onToggleDeleteSource: () => void;
}

export function WorkspaceMoveModal({
  modal,
  projects,
  currentProjectId,
  workspaceDivergence,
  onSelect,
  onConfirm,
  onToggleDeleteSource,
}: WorkspaceMoveModalProps) {
  const session = projects.find((s) => s.id === currentProjectId);
  const workspaces = session?.workspaces ?? [];
  const sourceId = modal.sourceWorkspaceId;
  const source = workspaces.find((w) => w.id === sourceId);
  const sourceLabel =
    source?.branch !== undefined && source.branch !== ""
      ? source.branch
      : (source?.name ?? "workspace");
  const targets = workspaces.filter((w) => w.id !== sourceId);
  const deleteSource = modal.deleteSource ?? false;
  return (
    <div className="flex flex-col gap-2">
      <div className="font-bold">
        Move <span style={{ color: theme.primary }}>{sourceLabel}</span> →
      </div>
      <div className="flex flex-col">
        {targets.length === 0 ? (
          <div className="px-2 py-1" style={{ color: theme.textMuted }}>
            No other workspace to move into.
          </div>
        ) : (
          targets.map((wt, index) => {
            const primary = wt.source === "primary" ? " (primary)" : "";
            const divergence = formatDivergence(workspaceDivergence[wt.id]);
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
        <Button
          variant="ghost"
          size="tui"
          aria-pressed={deleteSource}
          className="w-full justify-start px-2"
          onClick={onToggleDeleteSource}
        >
          <span style={{ color: theme.textMuted }}>delete source after move: </span>
          <span style={{ color: deleteSource ? theme.warning : theme.text }}>
            {deleteSource ? "on" : "off"}
          </span>
        </Button>
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

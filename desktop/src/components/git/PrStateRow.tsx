import { useCallback, useState } from "react";

import type { PrRowLite, PrSummaryLite } from "@aimux/gui-protocol";

import { Button } from "@/components/ui/button";
import { theme } from "@/lib/theme";

function toneColor(tone: PrRowLite["tone"]): string {
  if (tone === "ok") return theme.success;
  if (tone === "blocked") return theme.error;
  return theme.textMuted;
}

/**
 * Transcription of `pane/pr-state-row.tsx`. One row: the PR number as a link,
 * the headline GitHub puts on the merge box, and the single action worth
 * wiring to it — behind a yes/no confirm, because merging and removing a
 * worktree are both one click from irreversible.
 */
export function PrStateRow({
  onAct,
  onOpen,
  pr,
  row,
}: {
  pr: PrSummaryLite;
  row: PrRowLite;
  onOpen: (url: string) => void;
  onAct: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const confirm = useCallback(() => {
    setConfirming(false);
    onAct();
  }, [onAct]);

  const showAction = row.cleanup !== null || row.action === "merge";

  let label = row.label;
  if (confirming) {
    if (row.cleanup === "worktree") label = "Remove this worktree?";
    else if (row.cleanup === "branch") label = `Switch to ${row.base}?`;
    else label = "Merge this PR?";
  }

  return (
    <div
      className="tui-row px-[1ch]"
      style={{ backgroundColor: theme.backgroundElement }}
    >
      <Button
        variant="ghost"
        size="tui"
        className="px-0"
        title={pr.url}
        onClick={() => onOpen(pr.url)}
      >
        <span style={{ color: theme.textMuted }}>#{pr.number}</span>
        <span style={{ color: theme.primary }}> ↗</span>
      </Button>
      <span
        className="min-w-0 flex-1 truncate pl-[1ch]"
        style={{ color: confirming ? theme.warning : toneColor(row.tone) }}
      >
        {label}
      </span>
      {confirming ? (
        <>
          <Button
            variant="ghost"
            size="tui"
            className="font-bold"
            onClick={confirm}
            style={{ color: theme.success }}
          >
            yes
          </Button>
          <Button
            variant="ghost"
            size="tui"
            onClick={() => setConfirming(false)}
            style={{ color: theme.textMuted }}
          >
            no
          </Button>
        </>
      ) : null}
      {showAction && !confirming ? (
        <Button
          variant="ghost"
          size="tui"
          className="font-bold"
          onClick={() => setConfirming(true)}
          style={{ color: theme.primary }}
        >
          {row.cleanup === null ? "Merge" : "Clean up"}
        </Button>
      ) : null}
    </div>
  );
}

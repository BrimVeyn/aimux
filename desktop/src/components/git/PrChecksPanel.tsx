import { useCallback, useState } from "react";

import type {
  GitHubProjection,
  PrCheckLite,
  PrCheckState,
} from "@aimux/gui-protocol";

import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { theme } from "@/lib/theme";

/** Below this the workflow column crowds out the check name. */
const WORKFLOW_MIN_WIDTH = 34;

const STATE_GLYPH: Record<Exclude<PrCheckState, "pending">, string> = {
  cancel: "⊘",
  fail: "✗",
  pass: "✓",
  skipping: "○",
};

function stateColor(state: PrCheckState): string {
  if (state === "pass") return theme.success;
  if (state === "fail") return theme.error;
  if (state === "pending") return theme.warning;
  return theme.textMuted;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
}

function placeholder(
  status: GitHubProjection["status"],
): { label: string; color: string } | null {
  if (status === null) return { color: theme.textMuted, label: "…" };
  if (status.kind === "no-gh")
    return { color: theme.textMuted, label: "gh CLI not found" };
  if (status.kind === "no-pr")
    return { color: theme.textMuted, label: "No pull request" };
  return null;
}

/**
 * Transcription of `pane/pr-checks-panel.tsx`: the PR title, its diffstat, the
 * body as raw markdown, and the checks. The body is not rendered on purpose —
 * that would cost a parser, and the source is what the author actually wrote.
 */
export function PrChecksPanel({
  contentWidth,
  github,
  onOpenUrl,
  onSwitchAccount,
}: {
  github: GitHubProjection;
  /** In cells, to decide whether the workflow column fits. */
  contentWidth: number;
  onOpenUrl: (url: string) => void;
  onSwitchAccount: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const toggleBody = useCallback(() => setExpanded((prev) => !prev), []);
  const { stale, status } = github;

  if (status?.kind === "error") {
    return (
      <GhErrorState message={status.message} onSwitchAccount={onSwitchAccount} />
    );
  }

  const empty = placeholder(status);
  if (empty !== null || status?.kind !== "ok") {
    return (
      <div
        className="tui flex flex-1 justify-center pt-[--tui-row]"
        style={{
          backgroundColor: theme.backgroundPanel,
          color: empty?.color ?? theme.textMuted,
        }}
      >
        {empty?.label ?? "…"}
      </div>
    );
  }

  const { checks, pr } = status;
  // The padding below costs a column on each side.
  const showWorkflow = contentWidth - 2 >= WORKFLOW_MIN_WIDTH;
  const body = expanded ? pr.body : pr.bodyPreview;

  return (
    <div
      className="tui flex min-h-0 flex-1 flex-col overflow-y-auto p-[1ch]"
      style={{ backgroundColor: theme.backgroundPanel }}
    >
      <div className="whitespace-pre-wrap">
        <div
          className="font-bold"
          style={{ color: stale ? theme.textMuted : theme.text }}
        >
          {pr.title}
        </div>
        {/* The PR diffstat (base..head), not the working tree the files tab shows. */}
        <div className="tui-row gap-[1ch]">
          <span style={{ color: theme.success }}>+{pr.additions}</span>
          <span style={{ color: theme.error }}>-{pr.deletions}</span>
          <span style={{ color: theme.textMuted }}>
            {pr.changedFiles === 1 ? "1 file" : `${pr.changedFiles} files`}
          </span>
        </div>
      </div>

      {body !== "" ? (
        <div className="mt-[--tui-row]">
          <div
            className="whitespace-pre-wrap"
            style={{ color: theme.textMuted }}
          >
            {body}
          </div>
          {pr.bodyTruncated ? (
            <Button
              variant="ghost"
              size="tui"
              className="px-0"
              onClick={toggleBody}
              style={{ color: theme.primary }}
            >
              {expanded ? "▴ less" : "▾ more"}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-[--tui-row]">
        <div style={{ color: theme.textMuted }}>Checks</div>
        {checks.length === 0 ? (
          <div style={{ color: theme.textMuted }}>No checks</div>
        ) : (
          // GitHub can list the same workflow/name twice (a job that ran on
          // both `push` and `pull_request`), so the pair is not a unique key
          // and the duplicate crashes the reconciler. The rows hold no state
          // and the list is the API's own order, so the index is the key.
          checks.map((check, i) => (
            <CheckRow
              // oxlint-disable-next-line no-array-index-key
              key={`${i}:${check.workflow}/${check.name}`}
              check={check}
              onOpen={onOpenUrl}
              showWorkflow={showWorkflow}
            />
          ))
        )}
      </div>
    </div>
  );
}

function CheckRow({
  check,
  onOpen,
  showWorkflow,
}: {
  check: PrCheckLite;
  showWorkflow: boolean;
  onOpen: (url: string) => void;
}) {
  return (
    <Button
      variant="ghost"
      size="tui"
      className="w-full justify-start gap-[1ch] px-0"
      title={check.url}
      onClick={() => onOpen(check.url)}
    >
      <span className="w-[1ch] shrink-0" style={{ color: stateColor(check.state) }}>
        {check.state === "pending" ? (
          <Spinner color={theme.warning} />
        ) : (
          STATE_GLYPH[check.state]
        )}
      </span>
      <span className="min-w-0 flex-1 truncate" style={{ color: theme.text }}>
        {check.name}
      </span>
      {showWorkflow && check.workflow !== "" ? (
        <span className="shrink-0" style={{ color: theme.textMuted }}>
          {check.workflow}
        </span>
      ) : null}
      <span className="shrink-0" style={{ color: theme.textMuted }}>
        {formatDuration(check.durationMs)}
      </span>
    </Button>
  );
}

/**
 * Nearly every `gh` failure the pane can hit is really "the active account
 * can't see this repo", so the error state carries the one fix worth a click:
 * cycle to the next authenticated account and refetch.
 *
 * ponytail: the TUI names the accounts ("signed in as X", "Switch to Y"). That
 * needs `gh auth status` on the wire; put the names in the projection if the
 * unnamed switch turns out to be a guess too far.
 */
function GhErrorState({
  message,
  onSwitchAccount,
}: {
  message: string;
  onSwitchAccount: () => void;
}) {
  return (
    <div
      className="tui flex flex-1 flex-col items-center gap-[--tui-row] p-[1ch]"
      style={{ backgroundColor: theme.backgroundPanel }}
    >
      <div className="text-center" style={{ color: theme.error }}>
        ✗ {message}
      </div>
      <Button
        variant="ghost"
        size="tui"
        onClick={onSwitchAccount}
        style={{ color: theme.primary }}
      >
        ↺ Switch account
      </Button>
    </div>
  );
}

import { useEffect, useState } from "react";

import { theme } from "@/lib/theme";
import type { AIUsageProjection, AIUsageTool, UsageSnapshot } from "@/lib/types";

// Browser-side mirror of the TUI's compact usage indicator
// (src/ui/components/overlays/ai-usage/ai-usage-indicator.tsx). Per tool: an
// icon, a 4-segment bar, the percent (color-coded), and a reset countdown that
// is recomputed locally from `resetAt` so it ticks without a host rebroadcast.

const TOOL_ICON: Record<AIUsageTool, string> = {
  claude: "CC",
  codex: "CO",
};

const BAR_SEGMENTS = 4;
const BAR_FILLED_CHAR = "\u{2501}";
const BAR_EMPTY_CHAR = "\u{2500}";

function formatTokens(total: number): string {
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}M`;
  if (total >= 1_000) return `${(total / 1_000).toFixed(1)}k`;
  return String(total);
}

function buildBar(percent: number): { empty: string; filled: string } {
  let filledCount = 0;
  for (let i = 0; i < BAR_SEGMENTS; i++) {
    if (percent > i * (100 / BAR_SEGMENTS)) filledCount++;
  }
  return {
    empty: BAR_EMPTY_CHAR.repeat(BAR_SEGMENTS - filledCount),
    filled: BAR_FILLED_CHAR.repeat(filledCount),
  };
}

function formatResetIn(
  snap: { resetAt: string | null; timeRemaining: string | null },
  now: number,
): string | null {
  if (snap.resetAt !== null && snap.resetAt !== "") {
    const diffMs = new Date(snap.resetAt).getTime() - now;
    if (diffMs > 0) {
      const totalMin = Math.round(diffMs / 60_000);
      const h = Math.floor(totalMin / 60);
      const m = totalMin % 60;
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}h`;
    }
  }
  return snap.timeRemaining;
}

// Re-render once a minute so the reset countdown stays fresh.
function useMinuteTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function ToolBadge({
  snap,
  tool,
  now,
  onOpen,
}: {
  snap: UsageSnapshot;
  tool: AIUsageTool;
  now: number;
  onOpen: () => void;
}) {
  const icon = TOOL_ICON[tool];
  const isHardError = Boolean(snap.error) && snap.stale !== true;

  if (isHardError) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="cursor-pointer px-1"
        style={{ color: theme.error }}
      >
        {`${icon} —`}
      </button>
    );
  }

  if (snap.percent !== null) {
    const p = Math.round(snap.percent);
    let color: string = theme.success;
    if (p >= 85) color = theme.error;
    else if (p >= 60) color = theme.warning;
    const { empty, filled } = buildBar(snap.percent);
    const reset = formatResetIn(snap, now);
    const pctText = `${String(p).padStart(2, " ")}%`;
    return (
      <button
        type="button"
        onClick={onOpen}
        className="cursor-pointer whitespace-pre px-1"
      >
        <span style={{ color }}>{`${icon} `}</span>
        <span style={{ color }}>{filled}</span>
        <span style={{ color: theme.textMuted }}>{empty}</span>
        <span style={{ color: theme.text }}>{` ${pctText}`}</span>
        {reset !== null && reset !== "" ? (
          <span style={{ color: theme.textMuted }}>{` · ${reset}`}</span>
        ) : null}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="cursor-pointer px-1"
      style={{ color: theme.textMuted }}
    >
      {`${icon} ${formatTokens(snap.tokens.total)}`}
    </button>
  );
}

export function AIUsageIndicator({
  aiUsage,
  onOpen,
}: {
  aiUsage: AIUsageProjection;
  onOpen: () => void;
}) {
  const now = useMinuteTick();

  if (!aiUsage.enabled) return null;

  const ordered: AIUsageTool[] = ["claude", "codex"];
  const entries = ordered
    .map((tool) => ({ snap: aiUsage.snapshots[tool], tool }))
    .filter((entry): entry is { snap: UsageSnapshot; tool: AIUsageTool } =>
      entry.snap !== undefined,
    );

  if (entries.length === 0) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="cursor-pointer px-1"
        style={{ color: theme.textMuted }}
      >
        …
      </button>
    );
  }

  return (
    <div className="flex flex-row items-center gap-1">
      {entries.map(({ snap, tool }) => (
        <ToolBadge key={tool} snap={snap} tool={tool} now={now} onOpen={onOpen} />
      ))}
    </div>
  );
}
